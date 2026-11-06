process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getVerifiedTelegramChatId,
  shouldDispatchAlert,
  canDispatchProximityAlert,
  recordPriceBoundaryExit,
  clearAlertLedger,
  formatTelegramTradeDeskAlert,
  sendTelegramMessage,
  PROXIMITY_COOLDOWN_MS,
  getTradingDayKey,
} from "../../server/telegramDispatcher";
import {
  dispatchServerSetupAlert,
  clearNotificationAuditLog,
} from "../../server/backendNotificationWorker";

describe("Telegram Bot Refactor - Strict Channel Targeting, Session Deduplication & 1H Candle Gate", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearAlertLedger();
    clearNotificationAuditLog();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("1. Fix Recipient Routing (Enforce Numeric Telegram ID)", () => {
    it("deprecates and rejects non-numeric or @username identifiers", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(getVerifiedTelegramChatId("@myusername")).toBeNull();
      expect(getVerifiedTelegramChatId("@chizzle_alerts_bot")).toBeNull();
      expect(getVerifiedTelegramChatId("invalid_string_id")).toBeNull();
      expect(getVerifiedTelegramChatId("")).toBeNull();

      expect(consoleSpy).toHaveBeenCalledWith(
        "CRITICAL: Invalid or missing numeric TELEGRAM_TARGET_CHAT_ID."
      );
    });

    it("accepts valid numeric Telegram Chat IDs (including negative group/channel IDs)", () => {
      expect(getVerifiedTelegramChatId("7864955612")).toBe("7864955612");
      expect(getVerifiedTelegramChatId(7864955612)).toBe("7864955612");
      expect(getVerifiedTelegramChatId("-1001234567890")).toBe("-1001234567890");
    });

    it("falls back to process.env.TELEGRAM_TARGET_CHAT_ID if chatId parameter is omitted", () => {
      process.env.TELEGRAM_TARGET_CHAT_ID = "7864955612";
      expect(getVerifiedTelegramChatId()).toBe("7864955612");
    });

    it("falls back to TELEGRAM_CHAT_ID for backward compatibility when TELEGRAM_TARGET_CHAT_ID is unset", () => {
      delete process.env.TELEGRAM_TARGET_CHAT_ID;
      process.env.TELEGRAM_CHAT_ID = "7864955612";
      expect(getVerifiedTelegramChatId()).toBe("7864955612");
    });

    it("refuses to dispatch outbound payload when chat ID is an invalid username string", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_token_123";
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await sendTelegramMessage("Test alert", "@unverified_username");

      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Invalid ID");
      expect(consoleSpy).toHaveBeenCalledWith(
        "CRITICAL: Invalid or missing numeric TELEGRAM_TARGET_CHAT_ID."
      );
    });
  });

  describe("2. Kill the Alert Flood: Candle-Bound Hash Tracking", () => {
    it("tracks {ticker}_{interval}_{candleTimestamp}_{alertType} and suppresses duplicate ticks", () => {
      const ticker = "AAPL";
      const candleTs = 1730908800000; // specific 1H bar timestamp
      const alertType = "PROXIMITY_ALERT_05_PCT";

      // First tick evaluation: Should dispatch
      expect(shouldDispatchAlert(ticker, candleTs, alertType, "1h")).toBe(true);

      // Subsequent ticks on the same 1H bar (1-5 sec later): MUST be suppressed
      expect(shouldDispatchAlert(ticker, candleTs, alertType, "1h")).toBe(false);
      expect(shouldDispatchAlert(ticker, candleTs, alertType, "1h")).toBe(false);
      expect(shouldDispatchAlert("AAPL", candleTs, alertType, "1h")).toBe(false);

      // Different ticker on same candle: Should dispatch
      expect(shouldDispatchAlert("SMH", candleTs, alertType, "1h")).toBe(true);

      // Next 1H bar for same ticker: Should dispatch
      const nextCandleTs = candleTs + 3_600_000;
      expect(shouldDispatchAlert(ticker, nextCandleTs, alertType, "1h")).toBe(true);
    });
  });

  describe("3. Minimum Dispatch Cooldown & Strict Proximity Daily Limit", () => {
    it("enforces maximum once per day per ticker for Proximity Alert (< 0.5%)", () => {
      const now = Date.now();
      const today = getTradingDayKey(now);

      // First proximity alert today
      const first = canDispatchProximityAlert("JPM", now, today);
      expect(first.allowed).toBe(true);

      // Second tick 10 seconds later on same trading day: MUST be blocked
      const second = canDispatchProximityAlert("JPM", now + 10_000, today);
      expect(second.allowed).toBe(false);
      expect(second.reason).toContain("max once per day");

      // Even after 60 minutes, if still same trading day: MUST be blocked by once-per-day rule
      const after60m = canDispatchProximityAlert("JPM", now + 65 * 60 * 1000, today);
      expect(after60m.allowed).toBe(false);
      expect(after60m.reason).toContain("max once per day");
    });

    it("enforces hard 60-minute cooldown across trading sessions", () => {
      const now = Date.now();
      const day1 = "2026-11-06";
      const day2 = "2026-11-07";

      // Dispatched at end of day 1
      canDispatchProximityAlert("NVDA", now, day1);

      // 30 minutes later, even if calendar day rolled over: MUST be blocked by 60m cooldown
      const soonNextDay = canDispatchProximityAlert("NVDA", now + 30 * 60 * 1000, day2);
      expect(soonNextDay.allowed).toBe(false);
      expect(soonNextDay.reason).toContain("60-minute cooldown");
    });

    it("requires price to exit 0.5% boundary and re-enter before a second proximity alert", () => {
      const now = Date.now();
      const day1 = "2026-11-06";
      const day2 = "2026-11-07";

      canDispatchProximityAlert("CAT", now, day1);

      // Next day, after 60m cooldown, but price NEVER left boundary: MUST be blocked
      const afterCooldown = canDispatchProximityAlert("CAT", now + 24 * 3600 * 1000, day2);
      expect(afterCooldown.allowed).toBe(false);
      expect(afterCooldown.reason).toContain("has not exited the 0.5% boundary");

      // Price leaves boundary (pullback deeper or moves away)
      recordPriceBoundaryExit("CAT");

      // Now re-entry is allowed!
      const reEntry = canDispatchProximityAlert("CAT", now + 24 * 3600 * 1000, day2);
      expect(reEntry.allowed).toBe(true);
    });
  });

  describe("4. Strict Trigger Priority: Confirmed Entry (1H Green Candle Close)", () => {
    it("dispatches only once immediately following closed 1H bar validation", async () => {
      const candleBarTs = 1730908800000;

      // 1. First evaluation: confirmed 1H candle
      const first = await dispatchServerSetupAlert({
        symbol: "SMH",
        entryPrice: 245.5,
        stopLoss: 239.0,
        target1: 255.25,
        currentPrice: 245.6,
        sma20: 245.0,
        isTradeConfirmed: true,
        barTimestamp: candleBarTs,
      });

      expect(first.ok).toBe(true);
      expect(first.suppressed).toBe(false);
      expect(first.alertSent).toBe(true);

      // 2. Second tick on the same confirmed 1H bar: MUST be suppressed by candle dedupe
      const second = await dispatchServerSetupAlert({
        symbol: "SMH",
        entryPrice: 245.5,
        stopLoss: 239.0,
        target1: 255.25,
        currentPrice: 245.7,
        sma20: 245.0,
        isTradeConfirmed: true,
        barTimestamp: candleBarTs,
      });

      expect(second.ok).toBe(true);
      expect(second.suppressed).toBe(true);
      expect(second.auditEntry.badgeText).toContain("Suppressed");
    });
  });

  describe("5. Telegram Message Formatting (Compact Prop-Desk Template)", () => {
    it("formats message with exact compact prop-desk layout", () => {
      const msg = formatTelegramTradeDeskAlert({
        ticker: "AAPL",
        event: "CONFIRMED 1H CLOSE",
        regime: "Pullback Valid (4H 20-SMA)",
        entryPrice: 224.5,
        stopLoss: 219.8,
        target1: 231.55,
        target2: 233.9,
        shares: 53,
        t1Shares: 26,
        t2Shares: 27,
        status: "ACTIONABLE",
        timestamp: new Date("2026-11-06T14:30:00-06:00"),
      });

      // Verify exact header banner
      expect(msg).toContain("🎯 CHIZZLE TRADE DESK | [AAPL]");
      expect(msg).toContain("━━━━━━━━━━━━━━━━━━━━━━━━━━");
      expect(msg).toContain("⚡ EVENT: [ CONFIRMED 1H CLOSE ]");
      expect(msg).toContain("📈 REGIME: Pullback Valid (4H 20-SMA)");

      // Core price levels
      expect(msg).toContain("• Entry Limit:  $224.50");
      expect(msg).toContain("• Stop Loss:    $219.80 (-1.0R)");
      expect(msg).toContain("• Target 1:     $231.55 (+1.5R)");
      expect(msg).toContain("• Target 2:     $233.90 (+2.0R)");

      // Fidelity order ticket
      expect(msg).toContain("📋 FIDELITY ORDER TICKET:");
      expect(msg).toContain("BUY [53] Shares Limit @ $224.50");
      expect(msg).toContain("OCO SELL [26] Shares @ $231.55 (T1) | STOP [27] Shares @ $219.80");

      // Footer
      expect(msg).toContain("⏰ Time: 14:30:00 CT | Status: ACTIONABLE");
    });

    it("formats Proximity Alert event correctly", () => {
      const msg = formatTelegramTradeDeskAlert({
        ticker: "SMH",
        event: "PROXIMITY < 0.5%",
        entryPrice: 245.0,
        stopLoss: 239.0,
        shares: 40,
        timestamp: new Date("2026-11-06T10:15:00-06:00"),
      });

      expect(msg).toContain("🎯 CHIZZLE TRADE DESK | [SMH]");
      expect(msg).toContain("⚡ EVENT: [ PROXIMITY < 0.5% ]");
      expect(msg).toContain("BUY [40] Shares Limit @ $245.00");
      expect(msg).toContain("⏰ Time: 10:15:00 CT | Status: ACTIONABLE");
    });
  });
});
