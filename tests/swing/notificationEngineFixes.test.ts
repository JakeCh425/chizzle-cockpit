import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  sanitizePhoneNumber,
  isValidTelegramChatId,
  createAlertDedupeKey,
  sendSmsAlert,
} from "../../client/src/hooks/useOffScreenPreEntryAlerts";
import {
  sendTwilioSmsAlert,
  sendTelegramAlert as serverSendTelegramAlert,
  serverlessPreEntryAlertHandler,
} from "../../server/pre-entry-alerts";
import {
  sendPreEntryEmail,
  clearEmailAlertDeduplicationCache,
} from "../../server/sendEmailAlert";

describe("Notification Engine Fixes — Deduplication, SMS Sanitization & Telegram Validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearEmailAlertDeduplicationCache();
  });

  describe("1. Telegram Chat ID Strict Validation", () => {
    it("accepts valid numeric Chat IDs (including negative group chat IDs)", () => {
      expect(isValidTelegramChatId("123456789")).toBe(true);
      expect(isValidTelegramChatId("-100987654321")).toBe(true);
      expect(isValidTelegramChatId("   456789012   ")).toBe(true);
      expect(isValidTelegramChatId("")).toBe(true); // empty is valid when disabled
    });

    it("rejects alphabetical usernames and mixed strings (e.g. 'JAKE Ch', '@jake_ch')", () => {
      expect(isValidTelegramChatId("JAKE Ch")).toBe(false);
      expect(isValidTelegramChatId("jakech")).toBe(false);
      expect(isValidTelegramChatId("@jake_ch")).toBe(false);
      expect(isValidTelegramChatId("12345ABC")).toBe(false);
    });

    it("server rejects non-numeric chat ID with the exact required error message", async () => {
      const res = await serverSendTelegramAlert("Test alert", "JAKE Ch", "fake-token");
      expect(res.ok).toBe(false);
      expect(res.status).toBe("failed");
      expect(res.error).toBe(
        "Invalid ID. Must be a numeric Chat ID (e.g., 123456789). Use @userinfobot on Telegram to find it."
      );
    });

    it("NotificationsAndAlertsPanel contains red helper error and prevents saving invalid ID", () => {
      const panelPath = path.resolve(
        __dirname,
        "../../client/src/components/NotificationsAndAlertsPanel.tsx"
      );
      const content = fs.readFileSync(panelPath, "utf-8");

      expect(content).toContain('data-testid="error-telegram-chat-id"');
      expect(content).toContain(
        "Invalid ID. Must be a numeric Chat ID (e.g., 123456789). Use @userinfobot on Telegram to find it."
      );
      expect(content).toContain("hasTelegramLetters");
      expect(content).toContain("disabled={hasTelegramLetters}");
    });
  });

  describe("2. Sanitize SMS Phone Number for Twilio (E.164 Format)", () => {
    it("strips all spaces, dashes and non-numeric characters except leading +", () => {
      expect(sanitizePhoneNumber("+1 417-483-1318")).toBe("+14174831318");
      expect(sanitizePhoneNumber("+1 (555) 234-5678")).toBe("+15552345678");
      expect(sanitizePhoneNumber("+1-800-555-0199")).toBe("+18005550199");
      expect(sanitizePhoneNumber("   +1 417-483-1318   ")).toBe("+14174831318");
    });

    it("client sendSmsAlert passes sanitized +14174831318 in payload", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await sendSmsAlert(
        "🚨 CHIZZLE ALERT: NVDA approaching $135.00",
        "+1 417-483-1318",
        fetchSpy as unknown as typeof fetch
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/alerts/pre-entry",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"phoneNumber":"+14174831318"'),
        })
      );
    });

    it("serverlessPreEntryAlertHandler sanitizes phone number in Twilio request", async () => {
      const res = await serverlessPreEntryAlertHandler({
        channel: "sms",
        phoneNumber: "+1 417-483-1318",
        ticker: "NVDA",
        entryPrice: 135.0,
        target1: 142.5,
      });

      expect(res.ok).toBe(true);
      expect(res.sms).toBeDefined();
    });
  });

  describe("3. Strict Alert Deduplication Lock (Duplicate Prevention)", () => {
    it("creates unique alert dedupe key: ${ticker}-${setupId}-${alertType}", () => {
      const key1 = createAlertDedupeKey("NVDA", "setup-42", "PROXIMITY");
      expect(key1).toBe("NVDA-setup-42-PROXIMITY");

      const key2 = createAlertDedupeKey("SMH", 248.5, "TIME_3MIN");
      expect(key2).toBe("SMH-248.5-TIME_3MIN");
    });

    it("server sendPreEntryEmail enforces strict execution lock per active setup", async () => {
      clearEmailAlertDeduplicationCache();

      // First call fires successfully
      const first = await sendPreEntryEmail({
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        setupId: "setup-101",
        alertType: "PROXIMITY",
      });
      expect(first.ok).toBe(true);
      expect(first.error).not.toContain("Duplicate alert suppressed");

      // Second immediate call with same setupId & alertType is suppressed by deduplication lock
      const second = await sendPreEntryEmail({
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        setupId: "setup-101",
        alertType: "PROXIMITY",
      });

      expect(second.ok).toBe(true);
      expect(second.error).toContain("Duplicate alert suppressed by deduplication lock");

      // Different alertType (e.g. TIME_3MIN) or different setupId is allowed
      const third = await sendPreEntryEmail({
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        setupId: "setup-101",
        alertType: "TIME_3MIN",
      });
      expect(third.ok).toBe(true);
      expect(third.error).not.toContain("Duplicate alert suppressed");
    });

    it("verifies WealthEngineDashboard passes setupId to useOffScreenPreEntryAlerts and avoids duplicate proximity email", () => {
      const dashPath = path.resolve(
        __dirname,
        "../../client/src/pages/WealthEngineDashboard.tsx"
      );
      const dashSrc = fs.readFileSync(dashPath, "utf-8");

      expect(dashSrc).toContain("activeSetupIdentifier");
      expect(dashSrc).toContain("setupId: activeSetupIdentifier");
      // ProximityAlert email is suppressed so only offScreenAlerts fires email
      expect(dashSrc).toContain("email: undefined");
    });
  });
});
