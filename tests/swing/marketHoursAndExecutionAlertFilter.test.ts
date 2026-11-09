import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isRegularMarketHours,
  isUSMarketHoliday,
  getEtTimeParts,
} from "../../server/marketHours";
import {
  dispatchActionableTelegramAlert,
  canDispatchExecutionTelegram,
  recordExecutionTelegramSent,
  clearAlertLedger,
  formatTelegramTradeDeskAlert,
} from "../../server/telegramDispatcher";
import {
  dispatchApprovedExecutionEmail,
  isActionableExecution,
  canSendExecutionEmail,
  recordExecutionEmailSent,
  clearEmailDeduplicationLedger,
  formatApprovedSetupEmailSubject,
  formatApprovedSetupEmail,
} from "../../server/emailDispatcher";
import {
  dispatchServerSetupAlert,
  runBackendWatchlistAlertScan,
  clearNotificationAuditLog,
} from "../../server/backendNotificationWorker";

describe("Strict Market Hours Gate & Execution-Only Alert Filtering", () => {
  beforeEach(() => {
    clearAlertLedger();
    clearEmailDeduplicationLedger();
    clearNotificationAuditLog();
    vi.restoreAllMocks();
  });

  describe("1. Hard Market-Hours Gatekeeper (RTH Only: Mon-Fri 9:30 AM - 4:00 PM EST)", () => {
    it("returns true strictly within Regular Trading Hours on a normal business day", () => {
      // Wednesday Nov 11, 2026 at 10:30 AM EST (15:30 UTC during EST)
      // In EST (UTC-5): 10:30 AM EST = 15:30 UTC
      const rthOpen = new Date("2026-11-11T15:30:00Z");
      expect(isRegularMarketHours(rthOpen)).toBe(true);

      // 9:30 AM EST exactly = 14:30 UTC
      const marketOpenBell = new Date("2026-11-11T14:30:00Z");
      expect(isRegularMarketHours(marketOpenBell)).toBe(true);

      // 3:59 PM EST = 20:59 UTC
      const preClose = new Date("2026-11-11T20:59:00Z");
      expect(isRegularMarketHours(preClose)).toBe(true);
    });

    it("returns false at 5:18 PM CT / 6:18 PM EST (after-hours bug mentioned by user)", () => {
      // 5:18 PM CT = 6:18 PM EST = 23:18 UTC
      const afterHours518PmCT = new Date("2026-11-11T23:18:00Z");
      expect(isRegularMarketHours(afterHours518PmCT)).toBe(false);
    });

    it("returns false for pre-market and market close boundary", () => {
      // 8:00 AM EST = 13:00 UTC
      const preMarket = new Date("2026-11-11T13:00:00Z");
      expect(isRegularMarketHours(preMarket)).toBe(false);

      // 9:29 AM EST = 14:29 UTC (1 minute before open)
      const justBeforeOpen = new Date("2026-11-11T14:29:00Z");
      expect(isRegularMarketHours(justBeforeOpen)).toBe(false);

      // 4:00 PM EST = 21:00 UTC (closing bell)
      const atClose = new Date("2026-11-11T21:00:00Z");
      expect(isRegularMarketHours(atClose)).toBe(false);
    });

    it("returns false on weekends (Saturdays and Sundays)", () => {
      // Saturday Nov 14, 2026 at 12:00 PM EST = 17:00 UTC
      const saturday = new Date("2026-11-14T17:00:00Z");
      expect(isRegularMarketHours(saturday)).toBe(false);

      // Sunday Nov 15, 2026 at 12:00 PM EST = 17:00 UTC
      const sunday = new Date("2026-11-15T17:00:00Z");
      expect(isRegularMarketHours(sunday)).toBe(false);
    });

    it("returns false on official US Equity Market Holidays", () => {
      // Thanksgiving 2026 (Thursday Nov 26, 2026)
      const thanksgiving = new Date("2026-11-26T16:00:00Z");
      expect(isUSMarketHoliday(2026, 11, 26)).toBe(true);
      expect(isRegularMarketHours(thanksgiving)).toBe(false);

      // Christmas Day 2026 (Friday Dec 25, 2026)
      const christmas = new Date("2026-12-25T16:00:00Z");
      expect(isUSMarketHoliday(2026, 12, 25)).toBe(true);
      expect(isRegularMarketHours(christmas)).toBe(false);

      // Independence Day observed 2026 (Friday July 3, 2026 since July 4 is Saturday)
      expect(isUSMarketHoliday(2026, 7, 3)).toBe(true);
    });

    it("hard drops Telegram and Email alerts when fired outside regular market hours", async () => {
      // After-hours timestamp (6:18 PM EST / 5:18 PM CT)
      const afterHoursMs = new Date("2026-11-11T23:18:00Z").getTime();

      // Telegram dispatcher check
      const tgRes = await dispatchActionableTelegramAlert({
        ticker: "XLV",
        entryPrice: 145.2,
        stopLoss: 143.5,
        target1: 147.75,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: afterHoursMs,
        chatId: "7864955612",
      });
      expect(tgRes.ok).toBe(true);
      expect(tgRes.status).toBe("suppressed");
      expect(tgRes.error).toContain("Hard Market-Hours Gate");

      // Email dispatcher check
      const emailRes = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "XLV",
        entryPrice: 145.2,
        stopLoss: 143.5,
        target1: 147.75,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: afterHoursMs,
      });
      expect(emailRes.ok).toBe(true);
      expect(emailRes.status).toBe("suppressed");
      expect(emailRes.error).toContain("Hard Market-Hours Gate");

      // Server setup alert check
      const workerRes = await dispatchServerSetupAlert({
        symbol: "XLV",
        entryPrice: 145.2,
        stopLoss: 143.5,
        target1: 147.75,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        barTimestamp: afterHoursMs,
      });
      expect(workerRes.ok).toBe(true);
      expect(workerRes.suppressed).toBe(true);
      expect(workerRes.auditEntry.badgeText).toContain("Market Closed");

      // Background watchlist scanner pauses outside market hours
      const scanRes = await runBackendWatchlistAlertScan({
        now: afterHoursMs,
      });
      expect(scanRes.marketClosed).toBe(true);
      expect(scanRes.firedAlerts.length).toBe(0);
    });
  });

  describe("2. Kill 'Approaching / Pre-Entry' Spam Entirely (Execution-Only Filtering)", () => {
    it("deactivates and suppresses proximity / approaching alerts in all dispatchers", async () => {
      // Open market time: 10:30 AM EST (15:30 UTC)
      const rthMs = new Date("2026-11-11T15:30:00Z").getTime();

      // Telegram suppresses proximity alerts
      const tgProx = await dispatchActionableTelegramAlert({
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.0,
        status: "PROXIMITY_ALERT",
        isTradeConfirmed: false,
        now: rthMs,
      });
      expect(tgProx.status).toBe("suppressed");
      expect(tgProx.error).toContain("deprecated");

      // Email suppresses proximity alerts
      const emailProx = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.0,
        isProximityAlert: true,
        now: rthMs,
      });
      expect(emailProx.status).toBe("suppressed");
      expect(emailProx.error).toContain("deprecated");

      // Worker suppresses proximity alerts
      const workerProx = await dispatchServerSetupAlert({
        symbol: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.0,
        target1: 139.5,
        alertType: "PROXIMITY_EARLY_WARNING",
        barTimestamp: rthMs,
      });
      expect(workerProx.suppressed).toBe(true);
      expect(workerProx.auditEntry.badgeText).toContain("Proximity Deactivated");
    });

    it("strictly requires isActionableExecution: confirmed status, green candle close, trade confirmed, and R:R >= 1.5", () => {
      // 1. Valid actionable setup
      expect(
        isActionableExecution({
          status: "CONFIRMED",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 1.5,
          entryPrice: 100,
          stopLoss: 98,
          target2: 103,
        })
      ).toBe(true);

      // 2. Reject unconfirmed trade
      expect(
        isActionableExecution({
          status: "CONFIRMED",
          isTradeConfirmed: false,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 2.0,
        })
      ).toBe(false);

      // 3. Reject red candle close (rejection bar)
      expect(
        isActionableExecution({
          status: "CONFIRMED",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: false,
          riskRewardRatio: 2.0,
        })
      ).toBe(false);

      // 4. Reject forming/scanning/watch status
      expect(
        isActionableExecution({
          status: "FORMING",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 2.0,
        })
      ).toBe(false);

      // 5. Reject low R:R (< 1.5)
      expect(
        isActionableExecution({
          status: "CONFIRMED",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 1.2,
        })
      ).toBe(false);
    });
  });

  describe("3. Session & Candle-Based Deduplication (Max 1 Alert per Setup)", () => {
    it("deduplicates Telegram execution alerts using composite key ${ticker}_${candleTimestamp}_${tradeAction}", () => {
      const ticker = "XLV";
      const candleTs = 1730908800000;
      const tradingDay = "2026-11-11";

      // First check: allowed
      const first = canDispatchExecutionTelegram(ticker, candleTs, tradingDay, "CONFIRMED_BUY");
      expect(first.allowed).toBe(true);

      recordExecutionTelegramSent(ticker, candleTs, tradingDay, "CONFIRMED_BUY");

      // Same candle tick: blocked immediately
      const secondTick = canDispatchExecutionTelegram(ticker, candleTs, tradingDay, "CONFIRMED_BUY");
      expect(secondTick.allowed).toBe(false);
      expect(secondTick.reason).toContain("already sent for candle");

      // Later candle in the same trading day: blocked (max 1 execution alert per day)
      const nextCandleSameDay = canDispatchExecutionTelegram(
        ticker,
        candleTs + 3_600_000,
        tradingDay,
        "CONFIRMED_BUY"
      );
      expect(nextCandleSameDay.allowed).toBe(false);
      expect(nextCandleSameDay.reason).toContain("max 1 per session");

      // Next trading day: allowed
      const nextDay = canDispatchExecutionTelegram(
        ticker,
        candleTs + 86_400_000,
        "2026-11-12",
        "CONFIRMED_BUY"
      );
      expect(nextDay.allowed).toBe(true);
    });

    it("deduplicates Email execution alerts using composite key and session limit", () => {
      const ticker = "SPY";
      const candleTs = 1730908800000;
      const tradingDay = "2026-11-11";

      expect(canSendExecutionEmail(ticker, candleTs, tradingDay, "CONFIRMED_BUY").allowed).toBe(true);
      recordExecutionEmailSent(ticker, candleTs, tradingDay, "CONFIRMED_BUY");

      // Same candle
      expect(canSendExecutionEmail(ticker, candleTs, tradingDay, "CONFIRMED_BUY").allowed).toBe(false);

      // Same trading day
      expect(
        canSendExecutionEmail(ticker, candleTs + 3_600_000, tradingDay, "CONFIRMED_BUY").allowed
      ).toBe(false);

      // Next trading day
      expect(
        canSendExecutionEmail(ticker, candleTs + 86_400_000, "2026-11-12", "CONFIRMED_BUY").allowed
      ).toBe(true);
    });
  });

  describe("4. Focused Actionable Payload Formatting", () => {
    it("formats email subject matching exact requirement: 🚨 CHIZZLE EXECUTION READY: [TICKER] - 1H Closed Confirmed", () => {
      const subject = formatApprovedSetupEmailSubject("XLV");
      expect(subject).toBe("🚨 CHIZZLE EXECUTION READY: [XLV] - 1H Closed Confirmed");

      const subjectQqq = formatApprovedSetupEmailSubject("QQQ");
      expect(subjectQqq).toBe("🚨 CHIZZLE EXECUTION READY: [QQQ] - 1H Closed Confirmed");
    });

    it("delivers full verified trade parameters: Ticker, Validated SMA Support, Entry Limit, Stop Loss (1.0R), Target 1 (1.5R) / Target 2 (2.0R), and Fidelity order ticket", () => {
      const payload = {
        ticker: "XLV",
        supportLevel: "20-SMA Support ($145.20)",
        regime: "4H 20-SMA Pullback Valid",
        entryPrice: 145.2,
        stopLoss: 143.5,
        target1: 147.75,
        target2: 148.6,
        shares: 140,
        t1Shares: 70,
        t2Shares: 70,
        riskRewardRatio: 2.0,
      };

      const email = formatApprovedSetupEmail(payload);

      // Subject
      expect(email.subject).toBe("🚨 CHIZZLE EXECUTION READY: [XLV] - 1H Closed Confirmed");

      // Plaintext checks
      expect(email.text).toContain("TICKER: XLV");
      expect(email.text).toContain("VALIDATED SUPPORT: 20-SMA Support ($145.20)");
      expect(email.text).toContain("• Limit Entry Price:     $145.20");
      expect(email.text).toContain("• Protective Stop (1.0R): $143.50 (Stop Market)");
      expect(email.text).toContain("• Target 1 (1.5R):        $147.75 (Scale out 50%)");
      expect(email.text).toContain("• Target 2 (2.0R):        $148.60 (Core target)");
      expect(email.text).toContain("• Risk / Reward:         2.0:1 R:R");
      expect(email.text).toContain("FIDELITY TICKET PRESET:");
      expect(email.text).toContain("BUY [140] Shares Limit @ $145.20");
      expect(email.text).toContain("OCO SELL [70] Shares @ $147.75 (T1) | STOP [70] Shares @ $143.50");

      // HTML checks
      expect(email.html).toContain("🚨 CHIZZLE TRADE DESK · EXECUTION READY");
      expect(email.html).toContain("[XLV] · 1H Closed Confirmed");
      expect(email.html).toContain("Validated Support:</strong> 20-SMA Support ($145.20)");
      expect(email.html).toContain("$145.20");
      expect(email.html).toContain("$143.50 (Stop Market)");
      expect(email.html).toContain("$147.75 (Scale 50%)");
      expect(email.html).toContain("$148.60 (Core Target)");
      expect(email.html).toContain("BUY [140] Shares Limit @ $145.20");

      // Telegram message formatting checks
      const tgMsg = formatTelegramTradeDeskAlert({
        ticker: "XLV",
        event: "CONFIRMED 1H CLOSE",
        supportLevel: "20-SMA Support ($145.20)",
        regime: "4H 20-SMA Pullback Valid",
        entryPrice: 145.2,
        stopLoss: 143.5,
        target1: 147.75,
        target2: 148.6,
        shares: 140,
        t1Shares: 70,
        t2Shares: 70,
        status: "ACTIONABLE",
        timestamp: new Date("2026-11-11T15:30:00Z"),
      });

      expect(tgMsg).toContain("🎯 CHIZZLE TRADE DESK | [XLV]");
      expect(tgMsg).toContain("⚡ EVENT: [ CONFIRMED 1H CLOSE ]");
      expect(tgMsg).toContain("🛡️ SUPPORT: 20-SMA Support ($145.20)");
      expect(tgMsg).toContain("• Entry Limit:  $145.20");
      expect(tgMsg).toContain("• Stop Loss:    $143.50 (-1.0R)");
      expect(tgMsg).toContain("• Target 1:     $147.75 (+1.5R)");
      expect(tgMsg).toContain("• Target 2:     $148.60 (+2.0R)");
      expect(tgMsg).toContain("📋 FIDELITY ORDER TICKET:");
      expect(tgMsg).toContain("BUY [140] Shares Limit @ $145.20");
      expect(tgMsg).toContain("OCO SELL [70] Shares @ $147.75 (T1) | STOP [70] Shares @ $143.50");
    });
  });
});

