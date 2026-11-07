import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isApprovedSetupForEmail,
  canSendExecutionEmail,
  recordExecutionEmailSent,
  canSendProximityEmail,
  recordProximityEmailSent,
  clearEmailDeduplicationLedger,
  formatApprovedSetupEmailSubject,
  formatApprovedSetupEmail,
  dispatchApprovedExecutionEmail,
  EMAIL_PROXIMITY_COOLDOWN_MS,
} from "../../server/emailDispatcher";
import {
  sendPreEntryEmail,
  clearEmailAlertDeduplicationCache,
} from "../../server/sendEmailAlert";

describe("Email Notification Filter & Approved Setup Execution Gate", () => {
  beforeEach(() => {
    clearEmailDeduplicationLedger();
    clearEmailAlertDeduplicationCache();
    vi.restoreAllMocks();
  });

  describe("1. Execution Condition Gate (isApprovedSetupForEmail)", () => {
    it("approves setup when 1H candle closed green, trade confirmed, status confirmed, and R:R >= 2.0", () => {
      const approved = isApprovedSetupForEmail({
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.1,
        entryPrice: 150.0,
        stopLoss: 147.0,
        target2: 156.3,
      });
      expect(approved).toBe(true);
    });

    it("approves alternative terminal status strings like READY_TO_TRADE or CONFIRMED_1H_CLOSE", () => {
      expect(
        isApprovedSetupForEmail({
          status: "READY_TO_TRADE",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 2.0,
        })
      ).toBe(true);

      expect(
        isApprovedSetupForEmail({
          status: "CONFIRMED_1H_CLOSE",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 2.5,
        })
      ).toBe(true);
    });

    it("blocks setup when trade confirmation is missing or false", () => {
      const result = isApprovedSetupForEmail({
        status: "CONFIRMED",
        isTradeConfirmed: false,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.2,
      });
      expect(result).toBe(false);
    });

    it("blocks setup when 1H candle closed red (rejection bar, is1HCandleClosedGreen === false)", () => {
      const result = isApprovedSetupForEmail({
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: false,
        riskRewardRatio: 2.2,
      });
      expect(result).toBe(false);
    });

    it("blocks setup when status is non-terminal (e.g. FORMING, WATCH, NO_TRADE)", () => {
      expect(
        isApprovedSetupForEmail({
          status: "FORMING",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 2.0,
        })
      ).toBe(false);

      expect(
        isApprovedSetupForEmail({
          status: "WATCH",
          isTradeConfirmed: true,
          is1HCandleClosedGreen: true,
          riskRewardRatio: 2.0,
        })
      ).toBe(false);
    });

    it("blocks setup when risk/reward ratio is strictly below 1.5", () => {
      const result = isApprovedSetupForEmail({
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 1.2,
      });
      expect(result).toBe(false);
    });

    it("computes risk/reward ratio from prices if not explicitly supplied", () => {
      // entry 100, stop 98 (risk 2), target2 104.5 (reward 4.5 -> RR 2.25)
      const valid = isApprovedSetupForEmail({
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        entryPrice: 100,
        stopLoss: 98,
        target2: 104.5,
      });
      expect(valid).toBe(true);

      // entry 100, stop 98 (risk 2), target2 102.5 (reward 2.5 -> RR 1.25)
      const invalid = isApprovedSetupForEmail({
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        entryPrice: 100,
        stopLoss: 98,
        target2: 102.5,
      });
      expect(invalid).toBe(false);
    });
  });

  describe("2. Session & Candle-Bound Deduplication", () => {
    it("permits initial execution email for ticker on a new candle and day", () => {
      const check = canSendExecutionEmail("XLV", 1700000000, "2026-11-06");
      expect(check.allowed).toBe(true);
    });

    it("blocks duplicate execution email for the exact same candle", () => {
      recordExecutionEmailSent("XLV", 1700000000, "2026-11-06");

      const check = canSendExecutionEmail("XLV", 1700000000, "2026-11-06");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("already sent");
    });

    it("enforces max 1 execution email per ticker per trading day (session limit)", () => {
      recordExecutionEmailSent("MSFT", 1700000000, "2026-11-06");

      // Later candle in the same day (e.g. 1700003600 = +1 hour)
      const check = canSendExecutionEmail("MSFT", 1700003600, "2026-11-06");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("max 1 per session");
    });

    it("allows execution email on the next trading day", () => {
      recordExecutionEmailSent("NVDA", 1700000000, "2026-11-06");

      const nextDayCheck = canSendExecutionEmail("NVDA", 1700086400, "2026-11-07");
      expect(nextDayCheck.allowed).toBe(true);
    });
  });

  describe("3. Optional Pre-Entry Proximity Toggle & 120-Minute Cooldown", () => {
    it("drops pre-entry proximity emails by default (notifyOnProximity: false)", () => {
      const check = canSendProximityEmail("AAPL", false);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("disabled by default");
    });

    it("allows pre-entry proximity email when notifyOnProximity is explicitly true", () => {
      const check = canSendProximityEmail("AAPL", true);
      expect(check.allowed).toBe(true);
    });

    it("enforces strict 120-minute cooldown per ticker even when enabled", () => {
      const baseTime = 1700000000000;
      recordProximityEmailSent("AAPL", baseTime);

      // Attempt after 60 minutes (cooldown is 120 min)
      const midCheck = canSendProximityEmail("AAPL", true, baseTime + 60 * 60 * 1000);
      expect(midCheck.allowed).toBe(false);
      expect(midCheck.reason).toContain("120-minute cooldown");
      expect(midCheck.reason).toContain("60m remaining");

      // Attempt after 121 minutes
      const afterCheck = canSendProximityEmail(
        "AAPL",
        true,
        baseTime + (EMAIL_PROXIMITY_COOLDOWN_MS + 60000)
      );
      expect(afterCheck.allowed).toBe(true);
    });
  });

  describe("4. Professional Institutional Execution Card Formatting", () => {
    it("formats subject line matching: 🚨 CHIZZLE EXECUTION READY: [TICKER] - 1H Closed Confirmed", () => {
      const subject = formatApprovedSetupEmailSubject("XLV");
      expect(subject).toBe("🚨 CHIZZLE EXECUTION READY: [XLV] - 1H Closed Confirmed");

      const subjectTrimmed = formatApprovedSetupEmailSubject(" nvda  ");
      expect(subjectTrimmed).toBe("🚨 CHIZZLE EXECUTION READY: [NVDA] - 1H Closed Confirmed");
    });

    it("generates institutional card body with all mandatory metrics and Fidelity copy-paste block", () => {
      const payload = {
        ticker: "XLV",
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

      const { subject, text, html } = formatApprovedSetupEmail(payload);

      // Subject
      expect(subject).toBe("🚨 CHIZZLE EXECUTION READY: [XLV] - 1H Closed Confirmed");

      // Plaintext checks
      expect(text).toContain("TICKER: XLV");
      expect(text).toContain("Limit Entry Price:     $145.20");
      expect(text).toContain("Protective Stop (1.0R): $143.50 (Stop Market)");
      expect(text).toContain("Target 1 (1.5R):        $147.75 (Scale out 50%)");
      expect(text).toContain("Target 2 (2.0R):        $148.60 (Core target)");
      expect(text).toContain("Risk / Reward:         2.0:1 R:R");
      expect(text).toContain("FIDELITY TICKET PRESET:");
      expect(text).toContain("BUY [140] Shares Limit @ $145.20");
      expect(text).toContain("OCO SELL [70] Shares @ $147.75 (T1) | STOP [70] Shares @ $143.50");

      // HTML checks
      expect(html).toContain("🚨 CHIZZLE TRADE DESK · EXECUTION READY");
      expect(html).toContain("[XLV] · 1H Closed Confirmed");
      expect(html).toContain("Regime:</strong> 4H 20-SMA Pullback Valid");
      expect(html).toContain("$145.20");
      expect(html).toContain("$143.50 (Stop Market)");
      expect(html).toContain("$147.75 (Scale 50%)");
      expect(html).toContain("$148.60 (Core Target)");
      expect(html).toContain("FIDELITY TICKET PRESET (COPY-PASTE)");
      expect(html).toContain("BUY [140] Shares Limit @ $145.20");
    });
  });

  describe("5. End-to-End Dispatcher Gate Enforcement", () => {
    it("dispatchApprovedExecutionEmail suppresses unconfirmed setups", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "SPY",
        entryPrice: 580,
        stopLoss: 575,
        status: "FORMING",
        isTradeConfirmed: false,
        now: new Date("2026-11-11T15:30:00Z"),
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("not an actionable execution setup");
    });

    it("dispatchApprovedExecutionEmail suppresses pre-entry proximity alerts when notifyOnProximity is false", async () => {
      const res = await dispatchApprovedExecutionEmail({
        userEmail: "trader@example.com",
        ticker: "QQQ",
        entryPrice: 490,
        stopLoss: 485,
        isProximityAlert: true,
        notifyOnProximity: false,
        now: new Date("2026-11-11T15:30:00Z"),
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("deprecated");
    });

    it("sendPreEntryEmail seamlessly routes approved confirmed setups to institutional template and enforces session dedupe", async () => {
      const marketHoursTime = new Date("2026-11-11T15:30:00Z");

      // First send of approved setup
      const res1 = await sendPreEntryEmail({
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.0,
        target1: 139.5,
        target2: 141.0,
        shares: 80,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        candleTimestamp: "candle-100",
        tradingDay: "2026-11-06",
        now: marketHoursTime,
      });

      expect(res1.ok).toBe(true);
      expect(res1.subject).toBe("🚨 CHIZZLE EXECUTION READY: [NVDA] - 1H Closed Confirmed");

      // Second send in same trading session should be suppressed by deduplication gate
      const res2 = await sendPreEntryEmail({
        userEmail: "trader@example.com",
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.0,
        target1: 139.5,
        target2: 141.0,
        shares: 80,
        status: "CONFIRMED",
        isTradeConfirmed: true,
        is1HCandleClosedGreen: true,
        riskRewardRatio: 2.0,
        candleTimestamp: "candle-101",
        tradingDay: "2026-11-06",
        now: marketHoursTime,
      });

      expect(res2.ok).toBe(true);
      expect(res2.status).toBe("suppressed");
      expect(res2.error).toContain("max 1 per session");
    });

    it("sendPreEntryEmail suppresses automated proximity alerts when notifyOnProximity is false", async () => {
      const res = await sendPreEntryEmail({
        userEmail: "trader@example.com",
        ticker: "AMD",
        entryPrice: 160.0,
        alertType: "PROXIMITY_ALERT",
        isProximityAlert: true,
        notifyOnProximity: false,
        now: new Date("2026-11-11T15:30:00Z"),
      });

      expect(res.ok).toBe(true);
      expect(res.status).toBe("suppressed");
      expect(res.error).toContain("deprecated");
    });
  });
});

