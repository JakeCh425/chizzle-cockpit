// ─── Telegram Bot Dispatcher: Strict Numeric ID, Session Deduplication & 1H Candle Gate ───
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
// 5. Clean, compact prop-desk Telegram message formatting with Validated Support Level & Fidelity order ticket

import { isRegularMarketHours } from "./marketHours";
import { calculatePositionSize } from "../shared/positionSizing";

export { isRegularMarketHours, calculatePositionSize };

// Shared session-level deduplication cache: ${ticker}_${confirmedCandleTime}_ARMED
export const sentAlertsCache = new Map<string, number>();

export interface TelegramTradeAlertPayload {
  ticker: string;
  event: "CONFIRMED 1H CLOSE" | "PROXIMITY < 0.5%" | string;
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
  timestamp?: Date | number | string;
  status?: string;
}

export interface ProximityHistoryEntry {
  lastFiredMs: number;
  tradingDay: string;
  wasOutsideBoundary: boolean;
}

export const PROXIMITY_COOLDOWN_MS = 60 * 60 * 1000; // 60 minutes

// 1. In-memory ledger tracking {ticker}_{interval}_{candleTimestamp}_{alertType}
const alertLedger = new Set<string>();

// 2. Tracking for proximity alert daily limit & 60-minute cooldown
const proximityHistory = new Map<string, ProximityHistoryEntry>();

// 3. In-memory session tracking for max 1 Telegram execution alert per ticker per trading day
const executionTelegramDailyMap = new Map<string, number>();

export function getTradingDayKey(now: Date | number = Date.now()): string {
  const d = typeof now === "number" ? new Date(now) : now;
  try {
    return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Validates and extracts the definitive numeric Telegram Chat ID.
 * Deprecates and rejects '@username' strings or non-numeric identifiers.
 */
export function getVerifiedTelegramChatId(chatId?: string | number | null): string | null {
  if (chatId === null || chatId === undefined) {
    chatId = process.env.TELEGRAM_TARGET_CHAT_ID ?? process.env.TELEGRAM_CHAT_ID ?? "";
  }
  const raw = String(chatId).trim();

  if (!raw || isNaN(Number(raw))) {
    console.error("CRITICAL: Invalid or missing numeric TELEGRAM_TARGET_CHAT_ID.");
    return null;
  }

  return raw;
}

/**
 * Checks candle-bound deduplication and the 1-per-session limit for Telegram execution alerts.
 * Uses composite key: ${ticker}_${candleTimestamp}_${tradeAction}
 */
export function canDispatchExecutionTelegram(
  ticker: string,
  candleTimestamp: string | number,
  tradingDay = getTradingDayKey(),
  tradeAction = "CONFIRMED_BUY"
): { allowed: boolean; reason?: string } {
  const sym = (ticker || "").trim().toUpperCase();
  const compositeKey = `${sym}_${candleTimestamp}_${tradeAction}`;
  const dayKey = `${sym}_${tradingDay}_${tradeAction}`;

  // Rule 1: Candle-bound deduplication via composite key
  if (alertLedger.has(compositeKey)) {
    return {
      allowed: false,
      reason: `${sym} Telegram execution alert already sent for candle ${candleTimestamp} (${tradeAction}).`,
    };
  }

  // Rule 2: Max 1 execution alert per ticker per trading session (day)
  if (executionTelegramDailyMap.has(dayKey)) {
    return {
      allowed: false,
      reason: `${sym} Telegram execution alert already sent for session ${tradingDay} (max 1 per session).`,
    };
  }

  return { allowed: true };
}

export function recordExecutionTelegramSent(
  ticker: string,
  candleTimestamp: string | number,
  tradingDay = getTradingDayKey(),
  tradeAction = "CONFIRMED_BUY",
  nowMs = Date.now()
): void {
  const sym = (ticker || "").trim().toUpperCase();
  const compositeKey = `${sym}_${candleTimestamp}_${tradeAction}`;
  const dayKey = `${sym}_${tradingDay}_${tradeAction}`;
  alertLedger.add(compositeKey);
  executionTelegramDailyMap.set(dayKey, nowMs);
}

/**
 * Candle-Bound Hash Tracking:
 * Stores a dispatch ledger in memory tracking `{ticker}_{interval}_{candleTimestamp}_{alertType}`.
 * Returns false if already sent for this specific candle.
 */
export function shouldDispatchAlert(
  ticker: string,
  candleTimestamp: string | number,
  alertType: string,
  interval = "1h"
): boolean {
  const cleanTicker = (ticker || "").trim().toUpperCase();
  const cleanCandle =
    typeof candleTimestamp === "number"
      ? new Date(candleTimestamp).toISOString()
      : String(candleTimestamp || "");
  const alertKey = `${cleanTicker}_${interval}_${cleanCandle}_${alertType}`;

  if (alertLedger.has(alertKey)) {
    return false; // Already sent for this specific candle
  }

  alertLedger.add(alertKey);
  return true;
}

/**
 * Proximity Alert Gatekeeper:
 * Approaching / Pre-Entry proximity alerts are deactivated.
 */
export function canDispatchProximityAlert(
  ticker: string,
  nowMs = Date.now(),
  nowDay = getTradingDayKey(nowMs)
): { allowed: boolean; reason?: string } {
  const sym = (ticker || "").trim().toUpperCase();
  const hist = proximityHistory.get(sym);

  if (!hist) {
    proximityHistory.set(sym, {
      lastFiredMs: nowMs,
      tradingDay: nowDay,
      wasOutsideBoundary: false,
    });
    return { allowed: true };
  }

  // Rule 1: Proximity Alert (< 0.5%) allowed a maximum of ONCE PER DAY per ticker
  if (hist.tradingDay === nowDay) {
    return {
      allowed: false,
      reason: `${sym} Proximity Alert already sent for trading day ${nowDay} (max once per day).`,
    };
  }

  // Rule 2: Minimum Dispatch Cooldown (60 minutes)
  const elapsed = nowMs - hist.lastFiredMs;
  if (elapsed < PROXIMITY_COOLDOWN_MS) {
    const remainingMins = Math.ceil((PROXIMITY_COOLDOWN_MS - elapsed) / 60_000);
    return {
      allowed: false,
      reason: `${sym} Proximity Alert within 60-minute cooldown (${remainingMins}m remaining).`,
    };
  }

  // Rule 3: Price must leave the 0.5% boundary and re-enter
  if (!hist.wasOutsideBoundary) {
    return {
      allowed: false,
      reason: `${sym} has not exited the 0.5% boundary since the previous proximity alert.`,
    };
  }

  // Update history on valid dispatch
  hist.lastFiredMs = nowMs;
  hist.tradingDay = nowDay;
  hist.wasOutsideBoundary = false;
  return { allowed: true };
}

/**
 * Call when price leaves the 0.5% SMA boundary, enabling re-entry alert eligibility.
 */
export function recordPriceBoundaryExit(ticker: string): void {
  const sym = (ticker || "").trim().toUpperCase();
  const hist = proximityHistory.get(sym);
  if (hist) {
    hist.wasOutsideBoundary = true;
  }
}

/**
 * Clears the alert ledger and proximity history (useful for tests or new session).
 */
export function clearAlertLedger(): void {
  alertLedger.clear();
  proximityHistory.clear();
  executionTelegramDailyMap.clear();
}

export function getAlertLedger(): Set<string> {
  return new Set(alertLedger);
}

/**
 * Compact, clean prop-desk Telegram trade desk alert formatter:
 *
 * 🎯 CHIZZLE TRADE DESK | [TICKER]
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚡ EVENT: [ CONFIRMED 1H CLOSE | PROXIMITY < 0.5% ]
 * 🛡️ SUPPORT: 20-SMA Support | 📈 REGIME: Pullback Valid (4H 20-SMA)
 *
 * • Entry Limit:  $XXX.XX
 * • Stop Loss:    $XXX.XX (-1.0R)
 * • Target 1:     $XXX.XX (+1.5R)
 * • Target 2:     $XXX.XX (+2.0R)
 *
 * 📋 FIDELITY ORDER TICKET:
 * BUY [XX] Shares Limit @ $XXX.XX
 * OCO SELL [XX] Shares @ $XXX.XX (T1) | STOP [XX] Shares @ $XXX.XX
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⏰ Time: HH:MM:SS CT | Status: ACTIONABLE
 */
export function formatTelegramTradeDeskAlert(p: TelegramTradeAlertPayload): string {
  const ticker = (p.ticker || "NVDA").trim().toUpperCase();
  const entry = Number(p.entryPrice || 0);
  const stop = Number(p.stopLoss || 0);
  const risk = Math.max(0.01, Math.abs(entry - stop));
  const t1 = Number((p.target1 ?? (entry + 1.5 * risk)).toFixed(2));
  const t2 = Number((p.target2 ?? (entry + 2.0 * risk)).toFixed(2));

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

  const eventUpper = (p.event || "").toUpperCase();
  const eventLabel =
    eventUpper.includes("CONFIRM")
      ? "[ CONFIRMED 1H CLOSE ]"
      : eventUpper.includes("PROXIMITY")
      ? "[ PROXIMITY < 0.5% ]"
      : `[ ${p.event} ]`;

  const regime = p.regime || "Pullback Valid (4H 20-SMA)";
  const supportLevel = p.supportLevel || p.validatedSma;

  const dateObj =
    p.timestamp instanceof Date
      ? p.timestamp
      : typeof p.timestamp === "number" || typeof p.timestamp === "string"
      ? new Date(p.timestamp)
      : new Date();

  const timeStr =
    dateObj.toLocaleTimeString("en-US", {
      timeZone: "America/Chicago",
      hour12: false,
    }) + " CT";

  const status = p.status || "ACTIONABLE";

  const lines = [
    `🎯 CHIZZLE TRADE DESK | [${ticker}]`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ EVENT: ${eventLabel}`,
  ];

  if (supportLevel) {
    lines.push(`🛡️ SUPPORT: ${supportLevel} | REGIME: ${regime}`);
  } else {
    lines.push(`📈 REGIME: ${regime}`);
  }

  lines.push(
    ``,
    `• Entry Limit:  $${entry.toFixed(2)}`,
    `• Stop Loss:    $${stop.toFixed(2)} (-1.0R)`,
    `• Target 1:     $${t1.toFixed(2)} (+1.5R)`,
    `• Target 2:     $${t2.toFixed(2)} (+2.0R)`,
    ``,
    `📋 FIDELITY ORDER TICKET:`,
    `BUY [${shares}] Shares Limit @ $${entry.toFixed(2)}`,
    `OCO SELL [${t1Shares}] Shares @ $${t1.toFixed(2)} (T1) | STOP [${t2Shares}] Shares @ $${stop.toFixed(2)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⏰ Time: ${timeStr} | Status: ${status}`
  );

  return lines.join("\n");
}

/**
 * Top-Level Actionable Execution Telegram Dispatcher:
 * Enforces:
 * 1. Hard Market-Hours Gatekeeper (RTH Only)
 * 2. Kill "Approaching / Pre-Entry" Spam Entirely (Strict isActionableExecution check)
 * 3. Session & Candle-Based Deduplication: composite key ${ticker}_${candleTimestamp}_${tradeAction}
 *    and max 1 alert per ticker per trading day
 * 4. Focused Actionable Payload
 */
export async function dispatchActionableTelegramAlert(params: {
  ticker: string;
  entryPrice: number;
  stopLoss: number;
  target1?: number;
  target2?: number;
  shares?: number;
  t1Shares?: number;
  t2Shares?: number;
  supportLevel?: string;
  regime?: string;
  status?: string;
  isTradeConfirmed?: boolean;
  is1HCandleClosedGreen?: boolean;
  riskRewardRatio?: number;
  candleTimestamp?: string | number;
  tradingDay?: string;
  tradeAction?: string;
  chatId?: string | number | null;
  force?: boolean;
  now?: Date | number;
}): Promise<{
  ok: boolean;
  status: "sent" | "stubbed" | "failed" | "suppressed";
  error?: string;
  message?: string;
  targetChatId?: string;
}> {
  const ticker = (params.ticker || "NVDA").trim().toUpperCase();
  const evalTime =
    params.now ??
    (typeof params.candleTimestamp === "number" && params.candleTimestamp > 1_000_000_000_000
      ? params.candleTimestamp
      : Date.now());
  const evalMs = typeof evalTime === "number" ? evalTime : evalTime.getTime();

  // 1. Hard Market-Hours Gatekeeper (RTH Only: Mon-Fri 9:30 AM - 4:00 PM EST)
  if (!params.force && !isRegularMarketHours(evalTime)) {
    return {
      ok: true,
      status: "suppressed",
      error:
        "Hard Market-Hours Gate: Outbound alerts strictly blocked outside Regular Trading Hours (9:30 AM - 4:00 PM EST Mon-Fri).",
    };
  }

  // 2. Kill Approaching / Pre-Entry Spam Entirely
  const st = (params.status || "").toUpperCase();
  const isProximity =
    st.includes("PROX") ||
    st === "PRE_ENTRY" ||
    (params as any).isApproaching ||
    (params as any).withinProximity;

  if (isProximity && !params.force) {
    return {
      ok: true,
      status: "suppressed",
      error: "Approaching / Pre-Entry alerts deprecated. Execution alerts only.",
    };
  }

  // Execution condition check
  const isConfirmed =
    st.includes("CONFIRM") ||
    st === "READY_TO_TRADE" ||
    st === "CONFIRMED_1H_CLOSE" ||
    st === "CONFIRMED";

  let rr = params.riskRewardRatio;
  if (rr == null || Number.isNaN(rr)) {
    const risk = Math.max(0.01, Math.abs(params.entryPrice - params.stopLoss));
    const t2 = params.target2 ?? (params.entryPrice + 2.0 * risk);
    rr = (t2 - params.entryPrice) / risk;
  }

  const isActionable =
    isConfirmed &&
    params.isTradeConfirmed === true &&
    params.is1HCandleClosedGreen === true &&
    rr >= 1.45;

  // Lock Dispatch to "ARMED / READY TO TRADE" State Only
  const isReadyToArm = 
    isConfirmed &&
    params.is1HCandleClosedGreen === true &&
    params.isTradeConfirmed === true &&
    rr >= 1.45 &&
    isRegularMarketHours(evalTime) === true;

  if (!params.force && !isReadyToArm) {
    return {
      ok: true,
      status: "suppressed",
      error: "DROP ALERT: Setup is not 100% actionable",
    };
  }

  // Session-Level Deduplication (Max 1 Alert Per Ticker Per Day)
  const confirmedCandleTime = params.candleTimestamp ?? Math.floor(evalMs / 3_600_000);
  const alertKey = `${ticker}_${confirmedCandleTime}_ARMED`;
  if (!params.force && sentAlertsCache.has(alertKey)) {
    return {
      ok: true,
      status: "suppressed",
      error: `Already sent for this confirmed entry: ${alertKey}`,
    };
  }
  sentAlertsCache.set(alertKey, Date.now());

  // 3. Session & Candle-Based Deduplication (Max 1 Alert per Setup)
  const candleTs = params.candleTimestamp ?? Math.floor(Date.now() / 3_600_000);
  const dayKey = params.tradingDay ?? getTradingDayKey(evalTime);
  const tradeAction = params.tradeAction ?? "CONFIRMED_BUY";

  if (!params.force) {
    const check = canDispatchExecutionTelegram(ticker, candleTs, dayKey, tradeAction);
    if (!check.allowed) {
      return {
        ok: true,
        status: "suppressed",
        error: check.reason,
      };
    }
  }

  const message = formatTelegramTradeDeskAlert({
    ticker,
    event: "CONFIRMED 1H CLOSE",
    supportLevel: params.supportLevel,
    regime: params.regime ?? "Pullback Valid (4H 20-SMA)",
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    target1: params.target1,
    target2: params.target2,
    shares: params.shares,
    t1Shares: params.t1Shares,
    t2Shares: params.t2Shares,
    status: "ACTIONABLE",
    timestamp: evalTime,
  });

  const sendResult = await sendTelegramMessage(message, params.chatId);
  if (sendResult.ok || sendResult.status === "sent" || sendResult.status === "stubbed") {
    recordExecutionTelegramSent(ticker, candleTs, dayKey, tradeAction);
  }

  return {
    ...sendResult,
    message,
  };
}

/**
 * Dispatches a Telegram message to the verified numeric TELEGRAM_TARGET_CHAT_ID.
 * Deprecates and rejects non-numeric or username-based chat IDs.
 */
export async function sendTelegramMessage(
  text: string,
  chatId?: string | number | null,
  options?: { botToken?: string }
): Promise<{
  ok: boolean;
  status: "sent" | "stubbed" | "failed";
  error?: string;
  responseData?: any;
  targetChatId?: string;
}> {
  const token = options?.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      ok: false,
      status: "stubbed",
      error: "TELEGRAM_BOT_TOKEN not configured",
    };
  }

  const targetChatId = getVerifiedTelegramChatId(chatId);
  if (!targetChatId) {
    return {
      ok: false,
      status: "failed",
      error:
        "Invalid ID. Must be a numeric Chat ID (e.g., 123456789). Use @userinfobot on Telegram to find it.",
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: targetChatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      const errDesc = data?.description || `HTTP ${res.status}`;
      return {
        ok: false,
        status: "failed",
        error: `Telegram API error: ${errDesc}`,
        responseData: data,
        targetChatId,
      };
    }

    return {
      ok: true,
      status: "sent",
      responseData: data,
      targetChatId,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: "failed",
      error: err?.message || String(err),
      targetChatId,
    };
  }
}
