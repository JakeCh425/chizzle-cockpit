import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  formatPreEntryEmailSubject,
  formatPreEntryEmailHtml,
  sendPreEntryEmail,
} from "../../server/sendEmailAlert";
import {
  serverlessPreEntryAlertHandler,
} from "../../server/pre-entry-alerts";
import {
  loadOffScreenAlertSettings,
  saveOffScreenAlertSettings,
  sendEmailAlert,
  OFFSCREEN_ALERT_SETTINGS_KEY,
} from "../../client/src/hooks/useOffScreenPreEntryAlerts";

describe("Email Alert Integration & Notification UI Extension", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Email HTML Template & Formatting", () => {
    it("formats subject line matching exact template: 🚨 CHIZZLE ALERT: {Ticker} is approaching {Price}", () => {
      const subject = formatPreEntryEmailSubject("NVDA", 135.0);
      expect(subject).toBe("🚨 CHIZZLE ALERT: NVDA is approaching $135.00");

      const subjectWithDollar = formatPreEntryEmailSubject("SMH", "$248.50");
      expect(subjectWithDollar).toBe("🚨 CHIZZLE ALERT: SMH is approaching $248.50");
    });

    it("formats email body matching Lock-Screen Preview with high-contrast HTML", () => {
      const { html, text, subject } = formatPreEntryEmailHtml({
        ticker: "NVDA",
        price: 135.0,
        entryPrice: 135.0,
        target1: 142.5,
        context: "3 mins to 1H Close",
        plan: "Limit BUY at $135.00. Scale 50% at $142.50.",
      });

      expect(subject).toBe("🚨 CHIZZLE ALERT: NVDA is approaching $135.00");
      expect(text).toContain("🚨 CHIZZLE ALERT: NVDA is approaching $135.00");
      expect(text).toContain("Context: 3 mins to 1H Close");
      expect(text).toContain("Fidelity Plan: Limit BUY at $135.00. Scale 50% at $142.50.");

      // High-contrast HTML checks
      expect(html).toContain("<strong>Context:</strong> 3 mins to 1H Close");
      expect(html).toContain("<strong>Fidelity Plan:</strong> Limit BUY at $135.00. Scale 50% at $142.50.");
      expect(html).toContain("#0B0E14"); // Dark high-contrast background
      expect(html).toContain("#FFFFFF"); // High-contrast text
    });
  });

  describe("2. Backend Email Utility: sendPreEntryEmail", () => {
    it("handles positional arguments (userEmail, ticker, price, context, plan)", async () => {
      const result = await sendPreEntryEmail(
        "trader@example.com",
        "AAPL",
        225.5,
        "Price within 0.25% of SMA",
        "Limit BUY at $225.50. Scale 50% at $235.00."
      );

      expect(result.ok).toBe(true);
      expect(result.subject).toBe("🚨 CHIZZLE ALERT: AAPL is approaching $225.50");
      expect(result.message).toContain("Context: Price within 0.25% of SMA");
      expect(result.message).toContain("Fidelity Plan: Limit BUY at $225.50. Scale 50% at $235.00.");
    });

    it("handles object payload argument", async () => {
      const result = await sendPreEntryEmail({
        userEmail: "swingtrader@fidelity.com",
        ticker: "QQQ",
        price: 495.0,
        context: "Price within 0.25% of SMA",
        target1: 510.0,
      });

      expect(result.ok).toBe(true);
      expect(result.subject).toBe("🚨 CHIZZLE ALERT: QQQ is approaching $495.00");
    });

    it("fails cleanly when userEmail is missing", async () => {
      const result = await sendPreEntryEmail("", "NVDA", 135.0);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("User email address is required");
    });
  });

  describe("3. Serverless Dispatcher & Trigger Integration", () => {
    it("serverlessPreEntryAlertHandler dispatches email when channel=email or emailEnabled=true", async () => {
      const res = await serverlessPreEntryAlertHandler({
        channel: "email",
        email: "trader@example.com",
        ticker: "SMH",
        entryPrice: 248.5,
        target1: 256.8,
        context: "Price within 0.25% of SMA",
      });

      expect(res.ok).toBe(true);
      expect(res.email).toBeDefined();
      expect(res.email.ok).toBe(true);
      expect(res.email.subject).toBe("🚨 CHIZZLE ALERT: SMH is approaching $248.50");
    });

    it("client sendEmailAlert posts to /api/alerts/pre-entry with channel=email", async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, email: { ok: true } }),
      });

      const res = await sendEmailAlert(
        "🚨 CHIZZLE ALERT: NVDA is approaching $135.00.",
        "test@example.com",
        { ticker: "NVDA", entryPrice: 135.0, target1: 142.5 },
        fetchSpy as unknown as typeof fetch
      );

      expect(res.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/alerts/pre-entry",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"channel":"email"'),
        })
      );
    });
  });

  describe("4. State Management: Preferences Persistence", () => {
    it("persists and restores emailAddress and emailEnabled in localStorage", () => {
      const store: Record<string, string> = {};
      const mockStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
      };

      const saved = saveOffScreenAlertSettings(
        {
          phoneNumber: "+1 555-111-2222",
          telegramChatId: "12345678",
          emailAddress: "swingtrader@investing.com",
          email: "swingtrader@investing.com",
          smsEnabled: true,
          telegramEnabled: false,
          emailEnabled: true,
        },
        mockStorage
      );

      expect(saved.emailAddress).toBe("swingtrader@investing.com");
      expect(saved.emailEnabled).toBe(true);

      const loaded = loadOffScreenAlertSettings(mockStorage);
      expect(loaded.emailAddress).toBe("swingtrader@investing.com");
      expect(loaded.emailEnabled).toBe(true);
      expect(loaded.phoneNumber).toBe("+1 555-111-2222");
    });
  });

  describe("5. UI Verification: Notifications & Alerts Panel", () => {
    it("verifies NotificationsAndAlertsPanel contains Email Address input, EMAIL ON/OFF toggle, and save handler", () => {
      const panelPath = path.resolve(
        __dirname,
        "../../client/src/components/NotificationsAndAlertsPanel.tsx"
      );
      const content = fs.readFileSync(panelPath, "utf-8");

      expect(content).toContain("Email Address");
      expect(content).toContain('id="input-alert-email"');
      expect(content).toContain('data-testid="input-alert-email"');
      expect(content).toContain('data-testid="toggle-email-alerts"');
      expect(content).toContain("EMAIL ON");
      expect(content).toContain("EMAIL OFF");
      expect(content).toContain('data-testid="button-save-offscreen-alert-settings"');
      expect(content).toContain('data-testid="button-send-test-offscreen-alert"');
    });
  });
});

