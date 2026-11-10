import { describe, it, expect, beforeEach, vi } from "vitest";
import { calculatePositionSize } from "../../shared/positionSizing";
import {
  dispatchApprovedExecutionEmail,
  formatApprovedSetupEmail,
  sentAlertsCache as emailAlertsCache,
} from "../../server/emailDispatcher";
import {
  dispatchActionableTelegramAlert,
  formatTelegramTradeDeskAlert,
  sentAlertsCache as telegramAlertsCache,
} from "../../server/telegramDispatcher";
import {
  dispatchServerSetupAlert,
  formatExecutionReadyAlertMessage,
  sentAlertsCache as serverAlertsCache,
  clearNotificationAuditLog,
} from "../../server/backendNotificationWorker";
import { isRegularMarketHours } from "../../server/marketHours";

describe("Master Alert Fix - Synchronize Share Sizing & Lock Dispatch to ARMED / READY TO TRADE", () => {
  beforeEach(() => {
    emailAlertsCache.clear();
    telegramAlertsCache.clear();
    serverAlertsCache.clear();
    clearNotificationAuditLog();
    vi.restoreAllMocks();
  });

  describe("1. Shared Math Sizing Utility (calculatePositionSize)", () => {
    it("sizes properly for a ~$1,600 account balance (1 share of AAPL at $348 with $13 risk)", () => {
      // AAPL at $348 entry, $335 stop ($13 risk/share), $1,615 total equity, $1,600 available cash, 1.0% risk
      const res = calculatePositionSize(1615, 1600, 348, 335, 0.01);

      expect(res.totalShares).toBe(1);
      expect(res.t1Shares).toBe(0);
      expect(res.t2Shares).toBe(1);
    });

    it("prevents ungrounded 47 share sizing by capping with cashBasedShares and riskBudget", () => {
      // If someone previously had a 25k default equity, but only $1,600 cash
      // 47 shares of $348 would be $16,356. With $1,600 cash, it must never exceed cashBasedShares (4 shares).
      const res = calculatePositionSize(1615, 1600, 348, 342.7, 0.01);
      // Risk budget = $16.15, riskPerShare = $5.30 -> riskBasedShares = 3. Cash shares = 4.
      expect(res.totalShares).toBe(3);
      expect(res.totalShares * 348).toBeLessThanOrEqual(1600);
    });

    it("splits shares evenly across Target 1 and Target 2 when share count >= 2", () => {
      const res = calculatePositionSize(25000, 25000, 100, 95, 0.01);
      // Risk budget = $250, riskPerShare = $5 -> riskBasedShares = 50. Cash shares = 250.
      expect(res.totalShares).toBe(50);
      expect(res.t1Shares).toBe(25);
      expect(res.t2Shares).toBe(25);
    });

    it("returns 0 shares when riskPerShare <= 0", () => {
      const res = calculatePositionSize(10000, 10000, 100, 100, 0.01);
      expect(res.totalShares).toBe(0);
      expect(res.t1Shares).toBe(0);
      expect(res.t2Shares).toBe(0);
    });

    it("also supports the object-based signature used by UI cards and retains totalShares", () => {
      const res = calculatePositionSize({
        accountEquity: 1615,
        availableCash: 1600,
        entryPrice: 348,
        stopLossPrice: 335,
        riskPercentage: 1.0,
      });

      expect(res.totalShares).toBe(1);
      expect(res.calculatedShares).toBe(1);
      expect(res.t1Shares).toBe(0);
      expect(res.t2Shares).toBe(1);
      expect(res.isMarginRequired).toBe(false);
      expect(res.isInsufficientCash).toBe(false);
    });
  });

  describe("2. Fidelity Ticket Template Consistency across Outbound Channels", () => {
    it("embeds identical synchronized share sizing in email ticket template", () => {
      const formatted = formatApprovedSetupEmail({
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        target1: 367.5,
        target2: 374.0,
        // Omit shares so it calculates directly from calculatePositionSize(1615, 1600, ...)
      });

      expect(formatted.text).toContain("BUY [1] Shares Limit @ $348.00");
      expect(formatted.text).toContain("OCO SELL [0] Shares @ $367.50 (T1) | STOP [1] Shares @ $335.00");
    });

    it("embeds identical synchronized share sizing in Telegram trade desk alert ticket", () => {
      const telegramText = formatTelegramTradeDeskAlert({
        ticker: "AAPL",
        event: "CONFIRMED 1H CLOSE",
        entryPrice: 348.0,
        stopLoss: 335.0,
        target1: 367.5,
        target2: 374.0,
      });

      expect(telegramText).toContain("BUY [1] Shares Limit @ $348.00");
      expect(telegramText).toContain("OCO SELL [0] Shares @ $367.50 (T1) | STOP [1] Shares @ $335.00");
    });

    it("embeds identical synchronized share sizing in backend notification worker message", () => {
      const workerMsg = formatExecutionReadyAlertMessage({
        ticker: "AAPL",
        status: "CONFIRMED_1H_CLOSE",
        entryPrice: 348.0,
        stopLoss: 335.0,
        target1: 367.5,
        target2: 374.0,
      });

      expect(workerMsg).toContain("BUY 1 Shares Limit at $348.00");
      expect(workerMsg).toContain("Order 1 SELL 0 Shares @ $367.50 (1.5R) | Order 2 STOP 1 Shares @ $335.00");
    });
  });

  describe("3. Lock Dispatch to ARMED / READY TO TRADE State Only (Email Dispatcher)", () => {
    const marketHoursTime = new Date("2026-11-11T15:30:00Z"); // Wednesday 10:30 AM EST (RTH)
    const afterHoursTime = new Date("2026-11-11T23:18:00Z");  // 6:18 PM EST (Outside RTH)

    it("drops alert when status is not CONFIRMED / READY_TO_TRADE", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        status: "FORMING",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: Setup is not 100% actionable");
    });

    it("drops alert when 1H candle closed red (is1HCandleClosedGreen !== true)", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: false,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: Setup is not 100% actionable");
    });

    it("drops alert when isTradeConfirmed !== true", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        status: "CONFIRMED",
        isTradeConfirmed: false,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: Setup is not 100% actionable");
    });

    it("drops alert when riskRewardRatio < 1.5", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 1.2,
        now: marketHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: Setup is not 100% actionable");
    });

    it("drops alert when outside regular market hours", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: afterHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("Hard Market-Hours Gate");
    });

    it("drops pre-entry / proximity alert completely", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "AAPL",
        entryPrice: 348.0,
        stopLoss: 335.0,
        isProximityAlert: true,
        now: marketHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("Approaching / Pre-Entry alerts deprecated");
    });
  });

  describe("4. Lock Dispatch to ARMED / READY TO TRADE State Only (Telegram Dispatcher)", () => {
    const marketHoursTime = new Date("2026-11-11T15:30:00Z");

    it("drops telegram alert when setup is not armed / actionable", async () => {
      const res = await dispatchActionableTelegramAlert({
        ticker: "MSFT",
        entryPrice: 420.0,
        stopLoss: 410.0,
        status: "WATCH",
        isTradeConfirmed: false,
        is1HCandleClosedGreen: false,
        riskRewardRatio: 1.1,
        now: marketHoursTime,
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: Setup is not 100% actionable");
    });

    it("allows telegram alert when 100% armed and actionable in market hours", async () => {
      const res = await dispatchActionableTelegramAlert({
        ticker: "MSFT",
        entryPrice: 420.0,
        stopLoss: 410.0,
        target1: 435.0,
        target2: 440.0,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
        candleTimestamp: "candle-4001",
      });

      expect(res.status).toBe("stubbed");
    });
  });

  describe("5. Session-Level Deduplication (Max 1 Alert Per Ticker Per Day)", () => {
    const marketHoursTime = new Date("2026-11-11T15:30:00Z");

    it("suppresses duplicate email alert for the same confirmed entry candle", async () => {
      const payload = {
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 130.0,
        target1: 142.5,
        target2: 145.0,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        candleTimestamp: 1731339000000,
        now: marketHoursTime,
      };

      const res1 = await dispatchApprovedExecutionEmail(payload);
      expect(res1.ok).toBe(true);
      expect(res1.status).toBe("stubbed");

      // Second dispatch with same candleTimestamp should hit sentAlertsCache
      const res2 = await dispatchApprovedExecutionEmail(payload);
      expect(res2.ok).toBe(true);
      expect(res2.status).toBe("suppressed");
      expect(res2.error).toContain("Already sent for this confirmed entry");
    });

    it("suppresses duplicate telegram alert for the same confirmed entry candle", async () => {
      const payload = {
        ticker: "PLTR",
        entryPrice: 55.0,
        stopLoss: 52.0,
        target1: 59.5,
        target2: 61.0,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        candleTimestamp: 1731339000000,
        now: marketHoursTime,
      };

      const res1 = await dispatchActionableTelegramAlert(payload);
      expect(res1.status).toBe("stubbed");

      const res2 = await dispatchActionableTelegramAlert(payload);
      expect(res2.ok).toBe(true);
      expect(res2.status).toBe("suppressed");
      expect(res2.error).toContain("Already sent for this confirmed entry");
    });
  });
});
