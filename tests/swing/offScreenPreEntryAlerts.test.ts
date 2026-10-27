import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  formatPreEntryAlertMessage,
  evaluatePreEntryAlertTriggers,
  loadOffScreenAlertSettings,
  saveOffScreenAlertSettings,
  sendTelegramAlert,
  sendSmsAlert,
  PROXIMITY_ALERT_CONTEXT,
  TIME_BASED_ALERT_CONTEXT,
  PROXIMITY_THRESHOLD_PCT,
  PRE_CLOSE_MINUTE_TRIGGER,
  OFFSCREEN_ALERT_SETTINGS_KEY,
} from "../../client/src/hooks/useOffScreenPreEntryAlerts";
import {
  formatServerPreEntryAlertMessage,
  sendTelegramAlert as serverSendTelegramAlert,
  sendTwilioSmsAlert,
  serverlessPreEntryAlertHandler,
} from "../../server/pre-entry-alerts";

describe("Off-Screen Alerts — Telegram & SMS Pre-Entry Notifications", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Alert Message Formatting (Exact Lock-Screen Template)", () => {
    it("formats proximity alert message with exact multi-line lock-screen layout", () => {
      const msg = formatPreEntryAlertMessage({
        ticker: "SMH",
        entryPrice: 248.5,
        target1: 256.8,
        context: "Price within 0.25% of SMA",
      });

      expect(msg).toBe(
        [
          "🚨 CHIZZLE ALERT: SMH is approaching $248.50.",
          "Context: Price within 0.25% of SMA.",
          "Fidelity Plan: Limit BUY at $248.50. Scale 50% at $256.80.",
        ].join("\n")
      );
    });

    it("formats 1H pre-close time-based alert message with exact multi-line lock-screen layout", () => {
      const msg = formatPreEntryAlertMessage({
        ticker: "NVDA",
        entryPrice: "$135.00",
        target1: "$142.50",
        context: "3 mins to 1H Close",
      });

      expect(msg).toBe(
        [
          "🚨 CHIZZLE ALERT: NVDA is approaching $135.00.",
          "Context: 3 mins to 1H Close.",
          "Fidelity Plan: Limit BUY at $135.00. Scale 50% at $142.50.",
        ].join("\n")
      );
    });

    it("produces identical formatting on the backend dispatcher helper", () => {
      const clientMsg = formatPreEntryAlertMessage({
        ticker: "QQQ",
        entryPrice: 500,
        target1: 512.5,
        context: PROXIMITY_ALERT_CONTEXT,
      });
      const serverMsg = formatServerPreEntryAlertMessage({
        ticker: "QQQ",
        entryPrice: 500,
        target1: 512.5,
        context: PROXIMITY_ALERT_CONTEXT,
      });

      expect(serverMsg).toBe(clientMsg);
    });
  });

  describe("2. Pre-Entry Alert Triggers (Proximity <= 0.25% & Time-Based :57 + Single-Fire Deduplication)", () => {
    it("Trigger 1 (Proximity Warning): fires when live price comes within 0.25% of entryPrice", () => {
      const fired = new Set<string>();
      // Entry = $200.00; 0.20% above is $200.40 (<= 0.25% threshold)
      const res = evaluatePreEntryAlertTriggers(
        {
          ticker: "SMH",
          currentPrice: 200.4,
          entryPrice: 200.0,
          target1: 208.0,
          status: "Ready",
          now: new Date(2026, 9, 27, 10, 15, 0), // 10:15 AM (not :57)
        },
        fired
      );

      expect(PROXIMITY_THRESHOLD_PCT).toBe(0.25);
      expect(res.shouldFire).toBe(true);
      expect(res.triggerType).toBe("PROXIMITY_025_PCT");
      expect(res.context).toBe(PROXIMITY_ALERT_CONTEXT);
      expect(res.distancePct).toBeCloseTo(0.2, 4);
      expect(res.message).toContain("🚨 CHIZZLE ALERT: SMH is approaching $200.00.");
      expect(res.message).toContain("Context: Price within 0.25% of SMA.");
    });

    it("does not fire Proximity Warning when live price is further than 0.25% from entryPrice", () => {
      const fired = new Set<string>();
      // Entry = $200.00; $201.00 is 0.50% away (> 0.25%)
      const res = evaluatePreEntryAlertTriggers(
        {
          ticker: "SMH",
          currentPrice: 201.0,
          entryPrice: 200.0,
          target1: 208.0,
          status: "Ready",
          now: new Date(2026, 9, 27, 10, 15, 0),
        },
        fired
      );

      expect(res.shouldFire).toBe(false);
      expect(res.triggerType).toBeNull();
    });

    it("Trigger 2 (Time-Based Warning): fires when setup is FORMING and time is :57 (3 mins before 1H candle close)", () => {
      const fired = new Set<string>();
      // 9:57 AM -> minute === 57, status === "Forming", price is 1.5% away so proximity doesn't fire
      const res = evaluatePreEntryAlertTriggers(
        {
          ticker: "AAPL",
          currentPrice: 233.45,
          entryPrice: 230.0,
          target1: 239.0,
          status: "Forming",
          now: new Date(2026, 9, 27, 9, 57, 12),
        },
        fired
      );

      expect(PRE_CLOSE_MINUTE_TRIGGER).toBe(57);
      expect(res.shouldFire).toBe(true);
      expect(res.triggerType).toBe("TIME_3MIN_BEFORE_CLOSE");
      expect(res.context).toBe(TIME_BASED_ALERT_CONTEXT);
      expect(res.message).toContain("🚨 CHIZZLE ALERT: AAPL is approaching $230.00.");
      expect(res.message).toContain("Context: 3 mins to 1H Close.");
    });

    it("fires only ONCE per setup (deduplication prevents spam on subsequent ticks)", () => {
      const fired = new Set<string>();
      const input = {
        ticker: "SMH",
        currentPrice: 200.2,
        entryPrice: 200.0,
        target1: 208.0,
        status: "Forming",
        now: new Date(2026, 9, 27, 10, 15, 0),
      };

      const firstEval = evaluatePreEntryAlertTriggers(input, fired);
      expect(firstEval.shouldFire).toBe(true);
      if (firstEval.dedupeKey) fired.add(firstEval.dedupeKey);

      const secondEval = evaluatePreEntryAlertTriggers(input, fired);
      expect(secondEval.shouldFire).toBe(false);
    });
  });

  describe("3. Backend Integration (Telegram Bot API & Twilio SMS Serverless Handler)", () => {
    it("sendTelegramAlert posts directly to https://api.telegram.org/bot<token>/sendMessage when token and chatId are provided", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });

      const res = await sendTelegramAlert(
        "🚨 CHIZZLE ALERT: SMH is approaching $248.50.",
        "123456789",
        "TEST_BOT_TOKEN",
        fetchSpy as unknown as typeof fetch
      );

      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        "https://api.telegram.org/botTEST_BOT_TOKEN/sendMessage"
      );
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body).toEqual({
        chat_id: "123456789",
        text: "🚨 CHIZZLE ALERT: SMH is approaching $248.50.",
      });
    });

    it("sendSmsAlert posts to /api/alerts/pre-entry serverless endpoint", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, smsSent: true }),
      });

      const res = await sendSmsAlert(
        "🚨 CHIZZLE ALERT: SMH is approaching $248.50.",
        "+1 555-555-5555",
        fetchSpy as unknown as typeof fetch
      );

      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/alerts/pre-entry",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("serverlessPreEntryAlertHandler formats message and returns structured response", async () => {
      const result = await serverlessPreEntryAlertHandler({
        ticker: "SMH",
        entryPrice: 248.5,
        target1: 256.8,
        context: "Price within 0.25% of SMA",
        smsEnabled: false,
        telegramEnabled: false,
      });

      expect(result.ok).toBe(true);
      expect(result.message).toBe(
        [
          "🚨 CHIZZLE ALERT: SMH is approaching $248.50.",
          "Context: Price within 0.25% of SMA.",
          "Fidelity Plan: Limit BUY at $248.50. Scale 50% at $256.80.",
        ].join("\n")
      );
      expect(typeof serverSendTelegramAlert).toBe("function");
      expect(typeof sendTwilioSmsAlert).toBe("function");
    });
  });

  describe("4. User Notification Settings (UI Panel & Persistent Storage)", () => {
    it("persists and reloads SMS and Telegram settings via localStorage", () => {
      const store: Record<string, string> = {};
      const mockStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      };

      const saved = saveOffScreenAlertSettings(
        {
          phoneNumber: "+1 555-234-5678",
          telegramChatId: "987654321",
          smsEnabled: true,
          telegramEnabled: true,
        },
        mockStorage
      );

      expect(saved.phoneNumber).toBe("+1 555-234-5678");
      expect(saved.telegramChatId).toBe("987654321");
      expect(saved.smsEnabled).toBe(true);
      expect(saved.telegramEnabled).toBe(true);
      expect(store[OFFSCREEN_ALERT_SETTINGS_KEY]).toBeDefined();

      const loaded = loadOffScreenAlertSettings(mockStorage);
      expect(loaded).toEqual(saved);
    });

    it("renders NotificationsAndAlertsPanel with Phone Number (SMS), Telegram Chat ID tooltip, and independent toggles in WealthEngineDashboard", () => {
      const panelPath = path.resolve(
        __dirname,
        "../../client/src/components/NotificationsAndAlertsPanel.tsx"
      );
      const dashboardPath = path.resolve(
        __dirname,
        "../../client/src/pages/WealthEngineDashboard.tsx"
      );

      const panelSrc = fs.readFileSync(panelPath, "utf-8");
      const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8");

      // Check UI requirements in NotificationsAndAlertsPanel
      expect(panelSrc).toContain('data-testid="notifications-and-alerts-panel"');
      expect(panelSrc).toMatch(/Notifications\s*(?:&|&amp;)\s*Alerts/);
      expect(panelSrc).toContain("Phone Number (SMS)");
      expect(panelSrc).toContain("+1 555-555-5555");
      expect(panelSrc).toContain("Telegram Chat ID");
      expect(panelSrc).toContain('data-testid="tooltip-telegram-chat-id-help"');
      expect(panelSrc).toContain("@userinfobot");
      expect(panelSrc).toContain('data-testid="toggle-sms-alerts"');
      expect(panelSrc).toContain('data-testid="toggle-telegram-alerts"');

      // Check integration in WealthEngineDashboard
      expect(dashboardSrc).toContain('data-testid="tab-notifications-alerts"');
      expect(dashboardSrc).toContain("NotificationsAndAlertsPanel");
      expect(dashboardSrc).toContain("useOffScreenPreEntryAlerts");
    });
  });
});

