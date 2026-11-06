// ─── Telegram Bot Dispatcher: Strict Numeric ID, Session Deduplication & 1H Candle Gate ───
// Enforces:
// 1. Strict numeric TELEGRAM_TARGET_CHAT_ID (deprecates @username strings)
// 2. Candle-bound hash tracking ledger: {ticker}_{interval}_{candleTimestamp}_{alertType}
// 3. 60-minute minimum cooldown for proximity alerts & max once per day per ticker
// 4. Single confirmed entry alert per 1H closed bar (isTradeConfirmed === true)
// 5. Clean, compact prop-desk Telegram message formatting

export interface TelegramTradeAlertPayload {
  ticker: string;
  event: "CONFIRMED 1H CLOSE" | "PROXIMITY < 0.5%" | string;
  regime?: string;
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

// Tracking for proximity alert daily limit & 60-minute cooldown
const proximityHistory = new Map<string, ProximityHistoryEntry>();

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
 * Enforces:
 * 1. Maximum of ONCE PER DAY per ticker.
 * 2. Minimum 60-minute dispatch cooldown.
 * 3. Requires price to leave the 0.5% boundary and re-enter before another alert.
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
 * 📈 REGIME: Pullback Valid (4H 20-SMA)
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

  const shares = Math.max(
    1,
    p.shares && p.shares > 0 ? p.shares : Math.floor(250 / risk)
  );
  const t1Shares = p.t1Shares ?? Math.floor(shares / 2);
  const t2Shares = p.t2Shares ?? shares - t1Shares;

  const eventUpper = (p.event || "").toUpperCase();
  const eventLabel =
    eventUpper.includes("CONFIRM")
      ? "[ CONFIRMED 1H CLOSE ]"
      : eventUpper.includes("PROXIMITY")
      ? "[ PROXIMITY < 0.5% ]"
      : `[ ${p.event} ]`;

  const regime = p.regime || "Pullback Valid (4H 20-SMA)";

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

  return [
    `🎯 CHIZZLE TRADE DESK | [${ticker}]`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ EVENT: ${eventLabel}`,
    `📈 REGIME: ${regime}`,
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
    `⏰ Time: ${timeStr} | Status: ${status}`,
  ].join("\n");
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
