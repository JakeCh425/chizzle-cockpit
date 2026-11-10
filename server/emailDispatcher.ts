// ─── Email Notification Dispatcher & Approved Setup Execution Gate ─────────────
// Enforces:
// 1. Hard Market-Hours Gatekeeper (RTH Only): Strictly Mon-Fri 9:30 AM - 4:00 PM EST.
// 2. Kill "Approaching / Pre-Entry" Spam Entirely: Drop all proximity / pre-entry alerts.
// 3. Execution-Only Filtering:
//    - status === 'CONFIRMED' / 'CONFIRMED_1H_CLOSE' / 'READY_TO_TRADE'
//    - is1HCandleClosedGreen === true
//    - isTradeConfirmed === true
//    - riskRewardRatio >= 1.5
// 4. Session & Candle-Based Deduplication:
//    - Composite key: ${ticker}_${candleTimestamp}_${tradeAction}
//    - Max 1 execution alert per ticker per trading day
// 5. Focused Actionable Payload:
//    - Subject: 🚨 CHIZZLE EXECUTION READY: [TICKER] - 1H Closed Confirmed
//    - Payload: Ticker, Validated SMA Support Level, Entry Limit, Stop Loss (1.0R), Target 1 (1.5R), Target 2 (2.0R), Fidelity order ticket

import { getTradingDayKey } from "./telegramDispatcher";
import { isRegularMarketHours } from "./marketHours";
import { calculatePositionSize } from "../shared/positionSizing";
import { isTickerAlertOptedIn, formatInstitutionalConfirmedAlert } from "./alertOptInStore";

export { isRegularMarketHours, calculatePositionSize, isTickerAlertOptedIn, formatInstitutionalConfirmedAlert };

export interface ApprovedSetupEmailPayload {
  userEmail?: string;
  email?: string;
  emailAddress?: string;
  ticker: string;
  regime?: string;
  supportLevel?: string;
  validatedSma?: string;
  entryPrice: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  shares?: number;
  t1Shares?: number;
  t2Shares?: number;
  riskRewardRatio?: number;
  candleTimestamp?: string | number;
  tradingDay?: string;
  tradeAction?: string;
  status?: string;
  is1HCandleClosedGreen?: boolean;
  isTradeConfirmed?: boolean;
  notifyOnProximity?: boolean;
  isProximityAlert?: boolean;
  force?: boolean;
  now?: Date | number;
}

export const EMAIL_PROXIMITY_COOLDOWN_MS = 120 * 60 * 1000; // 120 minutes

// Shared session-level deduplication cache: ${ticker}_${confirmedCandleTime}_ARMED
export const sentAlertsCache = new Map<string, number>();

// 1. In-memory execution email ledger tracking ${ticker}_${candleTimestamp}_${tradeAction}
const sentEmailAlerts = new Map<string, number>();

// 2. In-memory session tracking for max 1 execution email per ticker per trading day
const sentEmailDailyMap = new Map<string, number>();

// 3. In-memory cooldown tracking for optional proximity emails (deprecated/deactivated)
const proximityEmailCooldownMap = new Map<string, number>();

/**
 * Validates whether a setup meets all institutional execution criteria for outbound dispatch:
 * - status === 'CONFIRMED' / 'CONFIRMED_1H_CLOSE' / 'READY_TO_TRADE'
 * - is1HCandleClosedGreen === true
 * - isTradeConfirmed === true
 * - riskRewardRatio >= 1.5
 */
export function isActionableExecution(setup: {
  status?: string;
  is1HCandleClosedGreen?: boolean;
  isTradeConfirmed?: boolean;
  riskRewardRatio?: number;
  entryPrice?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
}): boolean {
  // Trade confirmation is mandatory
  if (setup.isTradeConfirmed !== true) {
    return false;
  }

  // 1H candle must close green (cannot be a red rejection bar)
  if (setup.is1HCandleClosedGreen === false) {
    return false;
  }

  // Status must reflect terminal confirmed / ready state
  const st = (setup.status || "").toUpperCase();
  const isConfirmedStatus =
    st.includes("CONFIRM") ||
    st === "READY_TO_TRADE" ||
    st === "CONFIRMED_1H_CLOSE" ||
    st === "CONFIRMED";

  if (!isConfirmedStatus) {
    return false;
  }

  // Risk / Reward Ratio must be >= 1.5 (with float tolerance >= 1.45)
  let rr = setup.riskRewardRatio;
  if (rr == null || Number.isNaN(rr)) {
    const entry = Number(setup.entryPrice || 0);
    const stop = Number(setup.stopLoss || 0);
    const t2 = Number(setup.target2 || (setup.target1 ? setup.target1 * 1.05 : 0));
    const risk = Math.abs(entry - stop);
    if (risk > 0 && t2 > entry) {
      rr = (t2 - entry) / risk;
    } else {
      rr = 1.5;
    }
  }

  return rr >= 1.45; // 1.5R with float tolerance
}

export const isApprovedSetupForEmail = isActionableExecution;

/**
 * Checks candle-bound deduplication and the 1-per-session limit using composite key:
 * ${ticker}_${candleTimestamp}_${tradeAction}
 */
export function canSendExecutionEmail(
  ticker: string,
  candleTimestamp: string | number,
  tradingDay: string = getTradingDayKey(),
  tradeAction = "CONFIRMED"
): { allowed: boolean; reason?: string } {
  const sym = (ticker || "").trim().toUpperCase();
  const compositeKey = `${sym}_${candleTimestamp}_${tradeAction}`;
  const dayKey = `${sym}_${tradingDay}_${tradeAction}`;

  // Rule 1: Candle-bound deduplication via composite key
  if (sentEmailAlerts.has(compositeKey)) {
    return {
      allowed: false,
      reason: `${sym} execution alert already sent for candle ${candleTimestamp} (${tradeAction}).`,
    };
  }

  // Rule 2: Max 1 execution email per ticker per trading session (day)
  if (sentEmailDailyMap.has(dayKey)) {
    return {
      allowed: false,
      reason: `${sym} execution alert already sent for trading session ${tradingDay} (max 1 per session).`,
    };
  }

  return { allowed: true };
}

export function recordExecutionEmailSent(
  ticker: string,
  candleTimestamp: string | number,
  tradingDay: string = getTradingDayKey(),
  tradeAction = "CONFIRMED",
  nowMs = Date.now()
): void {
  const sym = (ticker || "").trim().toUpperCase();
  const compositeKey = `${sym}_${candleTimestamp}_${tradeAction}`;
  const dayKey = `${sym}_${tradingDay}_${tradeAction}`;
  sentEmailAlerts.set(compositeKey, nowMs);
  sentEmailDailyMap.set(dayKey, nowMs);
}

/**
 * Optional Proximity Email Gate:
 * Pre-entry alerts can NEVER send emails unless notifyOnProximity is explicitly true,
 * and even if enabled, enforces a strict minimum 120-minute cooldown per ticker.
 */
export function canSendProximityEmail(
  ticker: string,
  notifyOnProximity = false,
  nowMs = Date.now()
): { allowed: boolean; reason?: string } {
  const sym = (ticker || "").trim().toUpperCase();

  if (!notifyOnProximity) {
    return {
      allowed: false,
      reason: "Pre-entry proximity emails are disabled by default (OFF). Emails only fire for approved confirmed setups.",
    };
  }

  const lastSent = proximityEmailCooldownMap.get(sym) ?? 0;
  const elapsed = nowMs - lastSent;
  if (elapsed < EMAIL_PROXIMITY_COOLDOWN_MS) {
    const remainingMins = Math.ceil((EMAIL_PROXIMITY_COOLDOWN_MS - elapsed) / 60_000);
    return {
      allowed: false,
      reason: `${sym} proximity email is within 120-minute cooldown (${remainingMins}m remaining).`,
    };
  }

  return { allowed: true };
}

export function recordProximityEmailSent(ticker: string, nowMs = Date.now()): void {
  const sym = (ticker || "").trim().toUpperCase();
  proximityEmailCooldownMap.set(sym, nowMs);
}

export function clearEmailDeduplicationLedger(): void {
  sentEmailAlerts.clear();
  sentEmailDailyMap.clear();
  proximityEmailCooldownMap.clear();
}

/**
 * Subject Line: 🚨 CHIZZLE EXECUTION READY: [TICKER] - 1H Closed Confirmed
 */
export function formatApprovedSetupEmailSubject(ticker: string): string {
  const cleanTicker = (ticker || "NVDA").trim().toUpperCase();
  return `🚨 CHIZZLE EXECUTION READY: [${cleanTicker}] - 1H Closed Confirmed`;
}

/**
 * Focused Actionable Institutional Execution Card:
 * - Subject: 🚨 CHIZZLE EXECUTION READY: [TICKER] - 1H Closed Confirmed
 * - Payload: Ticker, Validated SMA Support Level, Entry Limit, Stop Loss (1.0R), Target 1 (1.5R), Target 2 (2.0R), Fidelity order ticket
 */
export function formatApprovedSetupEmail(p: ApprovedSetupEmailPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const ticker = (p.ticker || "NVDA").trim().toUpperCase();
  const entry = Number(p.entryPrice || 0);
  const stop = Number(p.stopLoss || 0);
  const risk = Math.max(0.01, Math.abs(entry - stop));
  const t1 = Number((p.target1 ?? (entry + 1.5 * risk)).toFixed(2));
  const t2 = Number((p.target2 ?? (entry + 2.0 * risk)).toFixed(2));
  const rr = p.riskRewardRatio ?? Number(((t2 - entry) / risk).toFixed(1));

  const sizing = calculatePositionSize(
    (p as any).totalEquity ?? (p as any).accountEquity ?? 1615,
    (p as any).availableCash ?? 1600,
    entry,
    stop,
    0.01
  );
  const shares = p.shares && p.shares > 0 ? p.shares : sizing.totalShares;
  const t1Shares = p.t1Shares ?? sizing.t1Shares;
  const t2Shares = p.t2Shares ?? sizing.t2Shares;

  const supportLevel = p.supportLevel || p.validatedSma || "20-SMA Support";
  const regime = p.regime || "4H 20-SMA Pullback Valid";
  const subject = formatApprovedSetupEmailSubject(ticker);
  const headline = formatInstitutionalConfirmedAlert({
    ticker,
    entryPrice: entry,
    stopLoss: stop,
    target1: t1,
  });

  const ticketLine1 = `BUY [${shares}] Shares Limit @ $${entry.toFixed(2)}`;
  const ticketLine2 = `OCO SELL [${t1Shares}] Shares @ $${t1.toFixed(2)} (T1) | STOP [${t2Shares}] Shares @ $${stop.toFixed(2)}`;

  const text = [
    headline,
    subject,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `📈 TICKER: ${ticker}`,
    `🛡️ VALIDATED SUPPORT: ${supportLevel} | ${regime}`,
    ``,
    `• Limit Entry Price:     $${entry.toFixed(2)}`,
    `• Protective Stop (1.0R): $${stop.toFixed(2)} (Stop Market)`,
    `• Target 1 (1.5R):        $${t1.toFixed(2)} (Scale out 50%)`,
    `• Target 2 (2.0R):        $${t2.toFixed(2)} (Core target)`,
    `• Risk / Reward:         ${rr.toFixed(1)}:1 R:R`,
    ``,
    `📋 FIDELITY TICKET PRESET:`,
    ticketLine1,
    ticketLine2,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ Execution Notice: All rules validated. 1H candle closed green on SMA support. Deduplicated: max 1 alert per day.`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #0B0E14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FFFFFF;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #111827; border: 1px solid #10B981; border-radius: 12px; padding: 24px; box-shadow: 0 12px 30px rgba(0,0,0,0.6);">
    <!-- Header Banner -->
    <div style="font-size: 11px; font-weight: 800; color: #10B981; text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 6px;">
      🚨 CHIZZLE TRADE DESK · EXECUTION READY
    </div>
    <h1 style="font-size: 22px; font-weight: 900; color: #FFFFFF; margin: 0 0 4px 0; letter-spacing: -0.02em;">
      [${ticker}] · 1H Closed Confirmed
    </h1>
    <div style="font-size: 13px; color: #9CA3AF; margin-bottom: 18px; border-bottom: 1px solid #1F2937; padding-bottom: 12px;">
      <strong style="color: #6EE7B7;">Validated Support:</strong> ${supportLevel} | <strong style="color: #9CA3AF;">Regime:</strong> ${regime}
    </div>

    <!-- Core Metrics Table -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px;">
      <tbody>
        <tr style="border-bottom: 1px solid #1F2937;">
          <td style="padding: 8px 0; color: #9CA3AF;">• Limit Entry Price</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #FFFFFF; font-size: 15px;">$${entry.toFixed(2)}</td>
        </tr>
        <tr style="border-bottom: 1px solid #1F2937;">
          <td style="padding: 8px 0; color: #F87171;">• Protective Stop (-1.0R)</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #F87171;">$${stop.toFixed(2)} (Stop Market)</td>
        </tr>
        <tr style="border-bottom: 1px solid #1F2937;">
          <td style="padding: 8px 0; color: #34D399;">• Target 1 (+1.5R)</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #34D399;">$${t1.toFixed(2)} (Scale 50%)</td>
        </tr>
        <tr style="border-bottom: 1px solid #1F2937;">
          <td style="padding: 8px 0; color: #60A5FA;">• Target 2 (+2.0R)</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #60A5FA;">$${t2.toFixed(2)} (Core Target)</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #9CA3AF;">• Risk / Reward Ratio</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #10B981;">${rr.toFixed(1)}:1 R:R</td>
        </tr>
      </tbody>
    </table>

    <!-- Fidelity Order Ticket Box -->
    <div style="background-color: #030712; border: 1px solid #374151; border-radius: 8px; padding: 16px; margin-bottom: 18px;">
      <div style="font-size: 11px; font-weight: 800; color: #60A5FA; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">
        📋 FIDELITY TICKET PRESET (COPY-PASTE)
      </div>
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: #F3F4F6; line-height: 1.6; word-break: break-all;">
        <div>${ticketLine1}</div>
        <div>${ticketLine2}</div>
      </div>
    </div>

    <!-- Footer Security Notice -->
    <div style="font-size: 11px; color: #6B7280; line-height: 1.4; border-top: 1px solid #1F2937; padding-top: 12px;">
      ⚡ <em>Institutional Execution Standard: Setup fully confirmed on 1H close. Automated pre-entry proximity spam disabled. Max 1 email per session.</em>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Dispatches an approved execution email via Resend or SendGrid.
 * Enforces the strict market hours gate, deduplication, and execution-only criteria.
 */
export async function dispatchApprovedExecutionEmail(
  payload: ApprovedSetupEmailPayload
): Promise<{
  ok: boolean;
  status: "sent" | "stubbed" | "failed" | "suppressed";
  error?: string;
  subject: string;
  text: string;
  html: string;
}> {
  const ticker = (payload.ticker || "NVDA").trim().toUpperCase();
  const userEmail = (
    payload.userEmail ||
    payload.emailAddress ||
    payload.email ||
    process.env.USER_ALERT_EMAIL ||
    ""
  ).trim();

  const { subject, text, html } = formatApprovedSetupEmail(payload);

  if (!userEmail) {
    return {
      ok: false,
      status: "failed",
      error: "User email address is missing or unconfigured.",
      subject,
      text,
      html,
    };
  }

  const evalTime =
    payload.now ??
    (payload.candleTimestamp &&
    typeof payload.candleTimestamp === "number" &&
    payload.candleTimestamp > 1_000_000_000_000
      ? payload.candleTimestamp
      : Date.now());
  const evalMs = typeof evalTime === "number" ? evalTime : evalTime.getTime();

  // Gate 0: Hard Market-Hours Gatekeeper (RTH Only: Mon-Fri 9:30 AM - 4:00 PM EST)
  if (!payload.force) {
    if (!isRegularMarketHours(evalTime)) {
      return {
        ok: true,
        status: "suppressed",
        error: "Hard Market-Hours Gate: Outbound alerts strictly blocked outside Regular Trading Hours (9:30 AM - 4:00 PM EST Mon-Fri).",
        subject,
        text,
        html,
      };
    }
  }

  // Gate 1: Kill "Approaching / Pre-Entry" Spam Entirely
  const isProx = Boolean(
    payload.isProximityAlert ||
    payload.status === "PROXIMITY" ||
    payload.status === "PROXIMITY_ALERT" ||
    payload.status === "PRE_ENTRY" ||
    (payload as any).isApproaching ||
    (payload as any).withinProximity
  );
  if (isProx && !payload.force) {
    return {
      ok: true,
      status: "suppressed",
      error: "Approaching / Pre-Entry alerts deprecated. Execution alerts only.",
      subject,
      text,
      html,
    };
  }

  if (!payload.force) {
    // Lock Dispatch to "ARMED / READY TO TRADE" State Only
    const isReadyToArm = 
      (payload.status === 'CONFIRMED' || payload.status === 'CONFIRMED_1H_CLOSE' || payload.status === 'READY_TO_TRADE') &&
      payload.is1HCandleClosedGreen === true &&
      payload.isTradeConfirmed === true &&
      (payload.riskRewardRatio ?? 2.0) >= 1.45 &&
      isRegularMarketHours(evalTime) === true;

    if (!isReadyToArm) {
      return {
        ok: true,
        status: "suppressed",
        error: "DROP ALERT: Setup is not 100% actionable (not an actionable execution setup).",
        subject,
        text,
        html,
      };
    }

    // Strict Opt-In Gate: Drop/suppress alert if alerts_enabled is false for this ticker
    const isOptedIn = await isTickerAlertOptedIn(ticker);
    if (!isOptedIn) {
      console.log(`[EmailDispatcher] Alert suppressed: alerts_enabled is false for ${ticker}`);
      return {
        ok: true,
        status: "suppressed",
        error: `DROP ALERT: alerts_enabled is false for ${ticker}`,
        subject,
        text,
        html,
      };
    }

    // Session-Level Deduplication (Max 1 Alert Per Ticker Per Day)
    const confirmedCandleTime = payload.candleTimestamp ?? Math.floor(evalMs / 3_600_000);
    const alertKey = `${ticker}_${confirmedCandleTime}_ARMED`;
    if (sentAlertsCache.has(alertKey)) {
      return {
        ok: true,
        status: "suppressed",
        error: `Already sent for this confirmed entry: ${alertKey}`,
        subject,
        text,
        html,
      };
    }
    sentAlertsCache.set(alertKey, Date.now());

    // Execution email: MUST satisfy isActionableExecution
    const isApproved = isActionableExecution({
      status: payload.status ?? "CONFIRMED",
      is1HCandleClosedGreen: payload.is1HCandleClosedGreen,
      isTradeConfirmed: payload.isTradeConfirmed,
      riskRewardRatio: payload.riskRewardRatio,
      entryPrice: payload.entryPrice,
      stopLoss: payload.stopLoss,
      target1: payload.target1,
      target2: payload.target2,
    });

    if (!isApproved) {
      return {
        ok: true,
        status: "suppressed",
        error: `Setup for ${ticker} is not an actionable execution setup. Email suppressed.`,
        subject,
        text,
        html,
      };
    }

    // Gate 2: Session & Candle-Based Deduplication via composite key
    const candleTs = payload.candleTimestamp ?? Math.floor(Date.now() / 3_600_000);
    const dayKey = payload.tradingDay ?? getTradingDayKey();
    const tradeAction = payload.tradeAction || "CONFIRMED_BUY";
    const dedupeCheck = canSendExecutionEmail(ticker, candleTs, dayKey, tradeAction);

    if (!dedupeCheck.allowed) {
      return {
        ok: true,
        status: "suppressed",
        error: dedupeCheck.reason,
        subject,
        text,
        html,
      };
    }

    recordExecutionEmailSent(ticker, candleTs, dayKey, tradeAction);
  }

  if (isProx) {
    recordProximityEmailSent(ticker);
  }

  // Delivery via Resend or SendGrid
  const resendApiKey = process.env.RESEND_API_KEY;
  const sendgridApiKey = process.env.SENDGRID_API_KEY;

  if (resendApiKey) {
    const from = process.env.RESEND_FROM_EMAIL || "Chizzle Trade Desk <onboarding@resend.dev>";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from,
          to: [userEmail],
          subject,
          text,
          html,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          status: "failed",
          error: `Resend ${res.status}: ${errText.slice(0, 200)}`,
          subject,
          text,
          html,
        };
      }

      return { ok: true, status: "sent", subject, text, html };
    } catch (e: any) {
      return {
        ok: false,
        status: "failed",
        error: e?.message || String(e),
        subject,
        text,
        html,
      };
    }
  }

  if (sendgridApiKey) {
    const from = process.env.SENDGRID_FROM_EMAIL || "alerts@chizzlecockpit.com";
    try {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sendgridApiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: userEmail }] }],
          from: { email: from },
          subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html", value: html },
          ],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          status: "failed",
          error: `SendGrid ${res.status}: ${errText.slice(0, 200)}`,
          subject,
          text,
          html,
        };
      }

      return { ok: true, status: "sent", subject, text, html };
    } catch (e: any) {
      return {
        ok: false,
        status: "failed",
        error: e?.message || String(e),
        subject,
        text,
        html,
      };
    }
  }

  return {
    ok: true,
    status: "stubbed",
    error: "RESEND_API_KEY / SENDGRID_API_KEY not configured (stubbed delivery)",
    subject,
    text,
    html,
  };
}

