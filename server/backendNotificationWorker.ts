// ─── Backend 24/7 Notification Engine & Setup Scanner Worker ───────────────
// Migrates useProximityAlert & useSetupScanner evaluation to a persistent
// server-side worker so Telegram, Resend Email, and Twilio SMS payloads
// execute 24/7 even when the browser tab is asleep or the laptop is closed.

import {
  sendTelegramAlert,
  sendTwilioSmsAlert,
  sendPreEntryEmail,
  formatProximityEarlyWarningMessage,
} from "./pre-entry-alerts";

export const DEFAULT_MONITORED_WATCHLIST: string[] = [
  "QQQ",
  "SMH",
  "SPY",
  "AAPL",
  "MSFT",
  "NVDA",
  "XLV",
  "XLE",
  "XLF",
  "XLI",
  "JPM",
  "CAT",
  "COST",
];

export interface ServerBar1H {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  closed?: boolean;
}

export interface ServerSetupEvaluation {
  symbol: string;
  confirmed: boolean;
  proximityTriggered: boolean;
  alertType:
    | "CONFIRMED_1H_20SMA"
    | "CONFIRMED_1H_10SMA"
    | "READY_TO_TRADE"
    | "PROXIMITY_EARLY_WARNING"
    | null;
  setupType: string;
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  calculatedShares: number;
  order1Shares: number;
  order2Shares: number;
  sma20: number | null;
  sma10: number | null;
  barTimestamp: number | null;
  reason: string;
}

export interface NotificationAuditEntry {
  id: string;
  symbol: string;
  alertType:
    | "CONFIRMED_1H_20SMA"
    | "CONFIRMED_1H_10SMA"
    | "READY_TO_TRADE"
    | "PROXIMITY_EARLY_WARNING"
    | "PRE_ENTRY_ALERT";
  setupType: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  calculatedShares: number;
  channels: Array<"telegram" | "email" | "sms">;
  delivery: {
    telegram?: { ok: boolean; status?: string; error?: string };
    email?: { ok: boolean; status?: string; id?: string; error?: string };
    sms?: { ok: boolean; status?: string; error?: string };
  };
  status: "SENT" | "STUBBED" | "FAILED";
  firedAt: number;
  isoTimestamp: string;
  formattedTime: string;
  badgeText: string;
  message: string;
  dedupeKey: string;
}

const notificationAuditLog: NotificationAuditEntry[] = [];
const firedDedupeKeys = new Set<string>();
let workerIntervalHandle: ReturnType<typeof setInterval> | null = null;

function computeSimpleMovingAverage(values: number[], period: number): number | null {
  if (!values || values.length === 0) return null;
  const slice = values.length >= period ? values.slice(-period) : values;
  const sum = slice.reduce((acc, v) => acc + v, 0);
  return Number((sum / slice.length).toFixed(2));
}

export function formatAlertTimestampCT(timestampMs: number = Date.now()): string {
  try {
    return new Date(timestampMs).toLocaleTimeString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return new Date(timestampMs).toISOString().slice(11, 16);
  }
}

/**
 * Evaluates 1-hour closed candle confirmation & proximity alerts on the server
 * for any watchlist ticker (e.g., XLV hitting and holding the 20-SMA or 10-SMA).
 */
export function evaluateServer1HCandleConfirmation(params: {
  symbol: string;
  bars1h: ServerBar1H[];
  currentPrice?: number;
  entryPriceOverride?: number;
  stopLossOverride?: number;
  target1Override?: number;
  setupStatus?: string;
  accountEquity?: number;
  riskPercentage?: number;
}): ServerSetupEvaluation {
  const symbol = params.symbol.trim().toUpperCase();
  const bars = params.bars1h || [];
  const closedBars = bars.filter((b) => b.closed !== false);
  const workingBars = closedBars.length > 0 ? closedBars : bars;
  const lastBar = workingBars.length > 0 ? workingBars[workingBars.length - 1] : null;
  const closes = workingBars.map((b) => b.c);

  const sma20 = computeSimpleMovingAverage(closes, 20);
  const sma10 = computeSimpleMovingAverage(closes, 10);
  const livePrice =
    params.currentPrice != null && params.currentPrice > 0
      ? params.currentPrice
      : lastBar?.c ?? 0;

  const isRunawayMomentum =
    sma20 != null && sma10 != null && livePrice > sma20 * 1.03;

  // Check if the latest closed 1H candle touched and held the 20-SMA or 10-SMA and closed green
  const isGreenClose = lastBar != null && lastBar.c >= lastBar.o;
  const holds20Sma =
    lastBar != null &&
    sma20 != null &&
    isGreenClose &&
    lastBar.l <= sma20 * 1.006 &&
    lastBar.c >= sma20 * 0.998;

  const holds10Sma =
    lastBar != null &&
    sma10 != null &&
    isRunawayMomentum &&
    isGreenClose &&
    lastBar.l <= sma10 * 1.006 &&
    lastBar.c >= sma10 * 0.998;

  const isStatusReady =
    params.setupStatus === "READY_TO_TRADE" ||
    params.setupStatus === "SETUP_CONFIRMED" ||
    params.setupStatus === "Ready";

  const anchorSupport = holds10Sma ? sma10! : sma20 ?? livePrice * 0.99;
  const entryPrice = Number(
    (
      params.entryPriceOverride ??
      (lastBar ? Math.max(lastBar.c, anchorSupport) : livePrice)
    ).toFixed(2)
  );
  const rawStop =
    params.stopLossOverride ??
    (lastBar
      ? Math.min(lastBar.l * 0.995, entryPrice * 0.985)
      : entryPrice * 0.985);
  const stopLoss = Number(Math.min(rawStop, entryPrice - 0.05).toFixed(2));
  const riskPerShare = Math.max(0.01, entryPrice - stopLoss);
  const target1 = Number(
    (params.target1Override ?? entryPrice + 1.5 * riskPerShare).toFixed(2)
  );
  const target2 = Number((entryPrice + 2.0 * riskPerShare).toFixed(2));

  const equity = params.accountEquity && params.accountEquity > 0 ? params.accountEquity : 25000;
  const riskPct = params.riskPercentage && params.riskPercentage > 0 ? params.riskPercentage : 1.0;
  const dollarRisk = equity * (riskPct / 100);
  const calculatedShares = Math.max(1, Math.floor(dollarRisk / riskPerShare));
  const order1Shares = Math.floor(calculatedShares / 2);
  const order2Shares = calculatedShares - order1Shares;

  // Proximity check (within 0.3% of entryPrice and above stopLoss)
  const alertThreshold = Number((entryPrice * 1.003).toFixed(4));
  const proximityTriggered =
    livePrice > 0 &&
    entryPrice > 0 &&
    livePrice <= alertThreshold &&
    livePrice >= stopLoss;

  let confirmed = false;
  let alertType: ServerSetupEvaluation["alertType"] = null;
  let setupType = "20-SMA Pullback Bounce · 1H";
  let reason = "Monitoring 1H structure";

  if (holds10Sma) {
    confirmed = true;
    alertType = "CONFIRMED_1H_10SMA";
    setupType = "[ MOMENTUM SETUP: 10-SMA ] · 1H";
    reason = `${symbol} 1H candle closed green holding 10-SMA ($${sma10?.toFixed(2)}) in runaway bull trend.`;
  } else if (holds20Sma) {
    confirmed = true;
    alertType = "CONFIRMED_1H_20SMA";
    setupType = "20-SMA Pullback Confirmed · 1H";
    reason = `${symbol} 1H candle closed green holding 20-SMA ($${sma20?.toFixed(2)}) support.`;
  } else if (isStatusReady) {
    confirmed = true;
    alertType = "READY_TO_TRADE";
    setupType = isRunawayMomentum ? "[ MOMENTUM SETUP: 10-SMA ] · 1H" : "20-SMA Swing Setup · 1H";
    reason = `${symbol} confirmed READY_TO_TRADE on 1H candle close.`;
  } else if (proximityTriggered) {
    alertType = "PROXIMITY_EARLY_WARNING";
    reason = `${symbol} trading within 0.3% of Entry ($${entryPrice.toFixed(2)}).`;
  }

  return {
    symbol,
    confirmed,
    proximityTriggered,
    alertType,
    setupType,
    currentPrice: livePrice,
    entryPrice,
    stopLoss,
    target1,
    target2,
    calculatedShares,
    order1Shares,
    order2Shares,
    sma20,
    sma10,
    barTimestamp: lastBar?.t ?? null,
    reason,
  };
}

/**
 * Records an alert event into the server-side Notification Audit Log so the UI
 * can render the `[ 🔔 Alert Sent ]` timestamp badge on the matching Setup Card.
 */
export function recordNotificationAudit(params: {
  symbol: string;
  alertType?: NotificationAuditEntry["alertType"];
  setupType?: string;
  entryPrice?: number;
  stopLoss?: number;
  target1?: number;
  calculatedShares?: number;
  channels?: Array<"telegram" | "email" | "sms">;
  delivery?: NotificationAuditEntry["delivery"];
  status?: "SENT" | "STUBBED" | "FAILED";
  firedAt?: number;
  message?: string;
  dedupeKey?: string;
}): NotificationAuditEntry {
  const symbol = (params.symbol || "NVDA").trim().toUpperCase();
  const firedAt = params.firedAt ?? Date.now();
  const formattedTime = formatAlertTimestampCT(firedAt);
  const entryPrice = Number(params.entryPrice ?? 0);
  const stopLoss = Number(params.stopLoss ?? 0);
  const target1 = Number(params.target1 ?? 0);
  const riskPerShare = Math.max(0.01, Math.abs(entryPrice - stopLoss));
  const calculatedShares =
    params.calculatedShares && params.calculatedShares > 0
      ? params.calculatedShares
      : entryPrice > 0 && stopLoss > 0
      ? Math.max(1, Math.floor(250 / riskPerShare))
      : 10;

  const entry: NotificationAuditEntry = {
    id: `alert-${symbol}-${firedAt}-${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    alertType: params.alertType ?? "CONFIRMED_1H_20SMA",
    setupType: params.setupType ?? "20-SMA Pullback Confirmed · 1H",
    entryPrice,
    stopLoss,
    target1,
    calculatedShares,
    channels: params.channels ?? ["telegram", "email", "sms"],
    delivery: params.delivery ?? {},
    status: params.status ?? "SENT",
    firedAt,
    isoTimestamp: new Date(firedAt).toISOString(),
    formattedTime,
    badgeText: `[ 🔔 Alert Sent · ${formattedTime} ]`,
    message:
      params.message ??
      `🚨 CHIZZLE CONFIRMED SETUP: ${symbol} 1H candle confirmed at $${entryPrice.toFixed(2)}. Stop $${stopLoss.toFixed(2)} · T1 $${target1.toFixed(2)} (${calculatedShares} shares).`,
    dedupeKey: params.dedupeKey ?? `${symbol}-${params.alertType ?? "CONFIRMED"}-${entryPrice.toFixed(2)}`,
  };

  notificationAuditLog.unshift(entry);
  if (notificationAuditLog.length > 250) {
    notificationAuditLog.length = 250;
  }
  firedDedupeKeys.add(entry.dedupeKey);
  return entry;
}

/**
 * Dispatches Twilio SMS, Resend Email, and Telegram Bot API payloads directly
 * from the backend server and logs the audit trail entry.
 */
export async function dispatchServerSetupAlert(params: {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  calculatedShares?: number;
  alertType?: NotificationAuditEntry["alertType"];
  setupType?: string;
  context?: string;
  barTimestamp?: number | null;
  chatId?: string;
  email?: string;
  phoneNumber?: string;
  force?: boolean;
}): Promise<{
  ok: boolean;
  suppressed: boolean;
  auditEntry: NotificationAuditEntry;
}> {
  const symbol = params.symbol.trim().toUpperCase();
  const alertType = params.alertType ?? "CONFIRMED_1H_20SMA";
  const barKey = params.barTimestamp ?? Math.floor(Date.now() / 3_600_000);
  const dedupeKey = `${symbol}-${alertType}-${Number(params.entryPrice || 0).toFixed(2)}-${barKey}`;

  if (!params.force && firedDedupeKeys.has(dedupeKey)) {
    const existing =
      notificationAuditLog.find((e) => e.dedupeKey === dedupeKey) ??
      getLatestAlertForSymbol(symbol)!;
    return {
      ok: true,
      suppressed: true,
      auditEntry:
        existing ||
        recordNotificationAudit({
          symbol,
          alertType,
          entryPrice: params.entryPrice,
          stopLoss: params.stopLoss,
          target1: params.target1,
          calculatedShares: params.calculatedShares,
          dedupeKey,
        }),
    };
  }

  const riskPerShare = Math.max(0.01, Math.abs(params.entryPrice - params.stopLoss));
  const calculatedShares =
    params.calculatedShares && params.calculatedShares > 0
      ? params.calculatedShares
      : Math.max(1, Math.floor(250 / riskPerShare));
  const order1Shares = Math.floor(calculatedShares / 2);
  const order2Shares = calculatedShares - order1Shares;

  const contextText =
    params.context ||
    (alertType === "CONFIRMED_1H_10SMA"
      ? "1H Candle Closed Green on 10-SMA Momentum Support"
      : alertType === "PROXIMITY_EARLY_WARNING"
      ? "Price within 0.3% of Entry Price"
      : "1H Candle Closed Green Holding 20-SMA Support");

  const message =
    alertType === "PROXIMITY_EARLY_WARNING"
      ? formatProximityEarlyWarningMessage({
          ticker: symbol,
          entryPrice: params.entryPrice,
        })
      : [
          `🚨 CHIZZLE CONFIRMED ENTRY: ${symbol} at $${params.entryPrice.toFixed(2)}`,
          `Context: ${contextText}.`,
          `Fidelity Ticket: BUY ${calculatedShares} Shares Limit at $${params.entryPrice.toFixed(2)}.`,
          `OCO Bracket: Order 1 SELL ${order1Shares} Shares @ $${params.target1.toFixed(2)} (1.5R) | Order 2 STOP ${order2Shares} Shares @ $${params.stopLoss.toFixed(2)}.`,
        ].join("\n");

  const targetChatId = params.chatId || process.env.TELEGRAM_CHAT_ID || "7864955612";
  const targetEmail = params.email || process.env.USER_ALERT_EMAIL || "jakechairez@gmail.com";
  const targetPhone = params.phoneNumber || process.env.ALERT_PHONE_NUMBER || "";

  const [telegramRes, emailRes, smsRes] = await Promise.all([
    sendTelegramAlert(message, targetChatId),
    sendPreEntryEmail({
      userEmail: targetEmail,
      ticker: symbol,
      entryPrice: params.entryPrice,
      target1: params.target1,
      context: contextText,
      setupId: `${symbol}-${barKey}`,
      alertType,
      plan: {
        entryPrice: params.entryPrice,
        stopLoss: params.stopLoss,
        target1: params.target1,
        shares: calculatedShares,
      },
    }),
    sendTwilioSmsAlert(targetPhone, message),
  ]);

  const channels: Array<"telegram" | "email" | "sms"> = ["telegram", "email", "sms"];
  const auditEntry = recordNotificationAudit({
    symbol,
    alertType,
    setupType: params.setupType ?? contextText,
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    target1: params.target1,
    calculatedShares,
    channels,
    delivery: {
      telegram: telegramRes,
      email: emailRes,
      sms: smsRes,
    },
    status: "SENT",
    message,
    dedupeKey,
  });

  return {
    ok: true,
    suppressed: false,
    auditEntry,
  };
}

export function getNotificationAuditLog(symbol?: string): NotificationAuditEntry[] {
  if (!symbol) return [...notificationAuditLog];
  const clean = symbol.trim().toUpperCase();
  return notificationAuditLog.filter((e) => e.symbol === clean);
}

export function getLatestAlertForSymbol(symbol: string): NotificationAuditEntry | null {
  if (!symbol) return null;
  const clean = symbol.trim().toUpperCase();
  return notificationAuditLog.find((e) => e.symbol === clean) ?? null;
}

export function getLatestAlertsBySymbolMap(): Record<string, NotificationAuditEntry> {
  const map: Record<string, NotificationAuditEntry> = {};
  for (const entry of notificationAuditLog) {
    if (!map[entry.symbol]) {
      map[entry.symbol] = entry;
    }
  }
  return map;
}

export function clearNotificationAuditLog(): void {
  notificationAuditLog.length = 0;
  firedDedupeKeys.clear();
}

/**
 * Runs one full server-side scan cycle across the active watchlist and immediately
 * fires Telegram, Resend Email, and Twilio SMS alerts for any confirmed setups.
 */
export async function runBackendWatchlistAlertScan(options?: {
  symbols?: string[];
  fetchBarsForSymbol?: (symbol: string) => Promise<ServerBar1H[]>;
  getQuoteForSymbol?: (symbol: string) => { price?: number } | null | undefined;
}): Promise<{
  scannedSymbols: string[];
  firedAlerts: NotificationAuditEntry[];
}> {
  const symbols = Array.from(
    new Set(
      (options?.symbols && options.symbols.length > 0
        ? options.symbols
        : DEFAULT_MONITORED_WATCHLIST
      ).map((s) => s.trim().toUpperCase())
    )
  );

  const firedAlerts: NotificationAuditEntry[] = [];

  for (const sym of symbols) {
    try {
      let bars: ServerBar1H[] = [];
      if (options?.fetchBarsForSymbol) {
        bars = await options.fetchBarsForSymbol(sym);
      } else {
        const { fetch1H } = await import("./swing/feed");
        const feedRes = await fetch1H(sym).catch(() => null);
        if (feedRes && Array.isArray((feedRes as any).bars)) {
          bars = (feedRes as any).bars;
        }
      }

      if (!bars || bars.length === 0) continue;

      const quote = options?.getQuoteForSymbol ? options.getQuoteForSymbol(sym) : null;
      const evaluation = evaluateServer1HCandleConfirmation({
        symbol: sym,
        bars1h: bars,
        currentPrice: quote?.price,
      });

      if (evaluation.confirmed && evaluation.alertType) {
        const dispatched = await dispatchServerSetupAlert({
          symbol: sym,
          entryPrice: evaluation.entryPrice,
          stopLoss: evaluation.stopLoss,
          target1: evaluation.target1,
          calculatedShares: evaluation.calculatedShares,
          alertType: evaluation.alertType,
          setupType: evaluation.setupType,
          context: evaluation.reason,
          barTimestamp: evaluation.barTimestamp,
        });
        if (!dispatched.suppressed) {
          firedAlerts.push(dispatched.auditEntry);
        }
      }
    } catch (err) {
      // Never let a single symbol error halt the 24/7 background worker
    }
  }

  return {
    scannedSymbols: symbols,
    firedAlerts,
  };
}

/**
 * Starts the persistent 24/7 server-side notification worker that continuously
 * monitors the active Watchlist independent of the user's browser.
 */
export function startBackendNotificationWorker(intervalMs = 60_000): {
  running: boolean;
  intervalMs: number;
} {
  if (workerIntervalHandle) {
    return { running: true, intervalMs };
  }

  workerIntervalHandle = setInterval(() => {
    void runBackendWatchlistAlertScan().catch((err) => {
      console.warn("[backend-notification-worker] scan error:", err?.message || err);
    });
  }, intervalMs);

  if (typeof (workerIntervalHandle as any)?.unref === "function") {
    (workerIntervalHandle as any).unref();
  }

  return { running: true, intervalMs };
}

export function stopBackendNotificationWorker(): void {
  if (workerIntervalHandle) {
    clearInterval(workerIntervalHandle);
    workerIntervalHandle = null;
  }
}

