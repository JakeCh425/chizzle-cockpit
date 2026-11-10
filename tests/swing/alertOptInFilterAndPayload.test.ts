import { describe, it, expect, beforeEach, vi } from "vitest";
import { watchlist } from "../../shared/schema";
import {
  isTickerAlertOptedIn,
  toggleTickerAlertOptIn,
  setTickerAlertOptIn,
  clearAlertOptInCache,
  formatInstitutionalConfirmedAlert,
} from "../../server/alertOptInStore";
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

describe("Strict Opt-In Alert Filtering & Institutional Payload", () => {
  const marketHoursTime = new Date("2026-11-11T15:30:00Z"); // Wednesday 10:30 AM EST (RTH)

  beforeEach(() => {
    emailAlertsCache.clear();
    telegramAlertsCache.clear();
    serverAlertsCache.clear();
    clearAlertOptInCache();
    clearNotificationAuditLog();
    vi.restoreAllMocks();
  });

  describe("Task 1: Database & Backend State (PostgreSQL Schema & Opt-In Gate)", () => {
    it("defines alerts_enabled boolean column on watchlist schema with false default", () => {
      expect(watchlist.alertsEnabled).toBeDefined();
      expect(watchlist.alertsEnabled.dataType).toBe("boolean");
      expect(watchlist.alertsEnabled.default).toBe(false);
    });

    it("defaults to alerts disabled (false) when ticker is unconfigured", async () => {
      const isOptedIn = await isTickerAlertOptedIn("UNCONFIGURED_TICKER");
      expect(isOptedIn).toBe(false);
    });

    it("allows toggling and explicit setting of ticker opt-in state", async () => {
      setTickerAlertOptIn("XLE", false);
      expect(await isTickerAlertOptedIn("XLE")).toBe(false);

      const toggledOn = await toggleTickerAlertOptIn("XLE", true);
      expect(toggledOn.alertsEnabled).toBe(true);
      expect(await isTickerAlertOptedIn("XLE")).toBe(true);

      const toggledOff = await toggleTickerAlertOptIn("XLE", false);
      expect(toggledOff.alertsEnabled).toBe(false);
      expect(await isTickerAlertOptedIn("XLE")).toBe(false);
    });

    it("silently suppresses Telegram alerts when alerts_enabled is false", async () => {
      setTickerAlertOptIn("XLE", false);

      const res = await dispatchActionableTelegramAlert({
        ticker: "XLE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
        status: "CONFIRMED_1H_CLOSE",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
      });

      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: alerts_enabled is false for XLE");
    });

    it("silently suppresses Email alerts when alerts_enabled is false", async () => {
      setTickerAlertOptIn("XLE", false);

      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "XLE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
        status: "READY_TO_TRADE",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
      });

      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("DROP ALERT: alerts_enabled is false for XLE");
    });

    it("silently suppresses Backend Notification Worker alerts when alerts_enabled is false", async () => {
      setTickerAlertOptIn("XLE", false);

      const res = await dispatchServerSetupAlert({
        symbol: "XLE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
        status: "CONFIRMED_1H_CLOSE",
        isTradeConfirmed: true,
        is1hCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        barTimestamp: marketHoursTime.getTime(),
      });

      expect(res.suppressed).toBe(true);
      expect(res.auditEntry.badgeText).toContain("Opt-In Disabled");
      expect(res.auditEntry.message).toContain("DROP ALERT: alerts_enabled is false for XLE");
    });

    it("dispatches successfully when alerts_enabled is true and 1H candle confirmed", async () => {
      setTickerAlertOptIn("XLE", true);

      const res = await dispatchActionableTelegramAlert({
        ticker: "XLE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
        status: "CONFIRMED_1H_CLOSE",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        now: marketHoursTime,
      });

      expect(res.status).not.toBe("suppressed");
      expect(res.message).toBeDefined();
    });
  });

  describe("Task 3: Refined Institutional Alert Payload", () => {
    it("formats exact institutional prop-desk alert headline", () => {
      const payload = formatInstitutionalConfirmedAlert({
        ticker: "XLE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
      });

      expect(payload).toBe("[ 🟢 1H CONFIRMED ] $XLE is ready. Entry: $62.12 | Stop: $61.19 | T1: $63.52.");
    });

    it("embeds institutional prop-desk headline in Telegram trade desk alert", () => {
      const msg = formatTelegramTradeDeskAlert({
        ticker: "XLE",
        event: "CONFIRMED 1H CLOSE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
      });

      expect(msg).toContain("[ 🟢 1H CONFIRMED ] $XLE is ready. Entry: $62.12 | Stop: $61.19 | T1: $63.52.");
      expect(msg).toContain("BUY [");
      expect(msg).toContain("OCO SELL [");
    });

    it("embeds institutional prop-desk headline in Email alert payload", () => {
      const email = formatApprovedSetupEmail({
        ticker: "XLE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
      });

      expect(email.text).toContain("[ 🟢 1H CONFIRMED ] $XLE is ready. Entry: $62.12 | Stop: $61.19 | T1: $63.52.");
    });

    it("embeds institutional prop-desk headline in backend notification worker message", () => {
      const workerMsg = formatExecutionReadyAlertMessage({
        ticker: "XLE",
        status: "CONFIRMED_1H_CLOSE",
        entryPrice: 62.12,
        stopLoss: 61.19,
        target1: 63.52,
        target2: 64.0,
      });

      expect(workerMsg).toContain("[ 🟢 1H CONFIRMED ] $XLE is ready. Entry: $62.12 | Stop: $61.19 | T1: $63.52.");
    });
  });
});
