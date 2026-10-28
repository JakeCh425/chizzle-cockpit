import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  calculateProximityAlertThreshold,
  formatProximityEarlyWarningMessage,
  evaluateProximityAlertTrigger,
} from "../../client/src/hooks/useProximityAlert";
import {
  calculateMaxChaseBuffer,
  calculateMaxEntryTolerance,
  evaluateEntryChaseStatus,
  evaluateTradeReadiness,
  TRADE_READY_BANNER_TEXT,
  TRADE_NOT_TRADEABLE_ENTRY_MISSED_BADGE,
} from "../../client/src/hooks/useTradeReadiness";
import {
  formatProximityEarlyWarningMessage as serverFormatEarlyWarning,
  sendProximityEarlyWarningAlert,
} from "../../server/pre-entry-alerts";

const dashboardPath = path.resolve(
  __dirname,
  "../../client/src/pages/WealthEngineDashboard.tsx"
);
const dashboardSrc = fs.readFileSync(dashboardPath, "utf-8");

describe("Proximity Alert System (Telegram/Email) & 'Ready to Trade' Banner Logic", () => {
  describe("1. Proximity Early-Warning Notifications (Telegram & Email)", () => {
    it("calculates alertThreshold = entryPrice * 1.003 (within 0.3% of entry)", () => {
      const entryPrice = 200.0;
      const threshold = calculateProximityAlertThreshold(entryPrice);
      expect(threshold).toBe(200.6); // 200 * 1.003
      expect(threshold).toBeCloseTo(entryPrice * 1.003, 4);
    });

    it("formats message exactly matching the requested template", () => {
      const msg = formatProximityEarlyWarningMessage({
        ticker: "SMH",
        entryPrice: 245.5,
      });
      expect(msg).toBe(
        "🚨 CHIZZLE EARLY WARNING: SMH is within 0.3% of your Entry Price ($245.50). Open your Fidelity app now and prepare for 1H candle close."
      );

      const serverMsg = serverFormatEarlyWarning({
        ticker: "NVDA",
        entryPrice: 120.0,
      });
      expect(serverMsg).toBe(
        "🚨 CHIZZLE EARLY WARNING: NVDA is within 0.3% of your Entry Price ($120.00). Open your Fidelity app now and prepare for 1H candle close."
      );
    });

    it("fires early-warning trigger when live price crosses into 0.3% threshold and dedupes subsequent ticks", () => {
      const entryPrice = 100.0;
      // 100 * 1.003 = 100.30
      // Price at 100.25 is within 0.3%
      const firedKeys = new Set<string>();
      const eval1 = evaluateProximityAlertTrigger({
        ticker: "AMD",
        currentPrice: 100.25,
        entryPrice,
        alreadyFiredKeys: firedKeys,
      });
      expect(eval1.shouldFire).toBe(true);
      expect(eval1.isWithinThreshold).toBe(true);
      expect(eval1.alertThreshold).toBe(100.3);

      // Add to alreadyFiredKeys and verify deduplication
      firedKeys.add(eval1.dedupeKey);
      const eval2 = evaluateProximityAlertTrigger({
        ticker: "AMD",
        currentPrice: 100.2,
        entryPrice,
        alreadyFiredKeys: firedKeys,
      });
      expect(eval2.shouldFire).toBe(false);
      expect(eval2.isWithinThreshold).toBe(true);
    });

    it("connects to Telegram Bot API and lightweight Email service in sendProximityEarlyWarningAlert", async () => {
      const res = await sendProximityEarlyWarningAlert({
        ticker: "TSLA",
        entryPrice: 215.0,
      });
      expect(res.ok).toBe(true);
      expect(res.message).toContain("🚨 CHIZZLE EARLY WARNING: TSLA is within 0.3% of your Entry Price ($215.00)");
      expect(res.telegram).toBeDefined();
      expect(res.email).toBeDefined();
    });

    it("integrates useProximityAlert into WealthEngineDashboard.tsx", () => {
      expect(dashboardSrc).toContain("useProximityAlert");
      expect(dashboardSrc).toContain("proximityAlert = useProximityAlert({");
    });
  });

  describe("2. 'READY TO TRADE' Banner & Unlock State", () => {
    it("renders full-width pulsing Emerald Green Banner with '[ ⚡ READY TO TRADE - CONFIRM EXECUTION ]'", () => {
      expect(dashboardSrc).toContain('data-testid="banner-ready-to-trade"');
      expect(dashboardSrc).toContain("[ ⚡ READY TO TRADE - CONFIRM EXECUTION ]");
      expect(TRADE_READY_BANNER_TEXT).toBe("[ ⚡ READY TO TRADE - CONFIRM EXECUTION ]");
    });

    it("evaluates isTradeReady state when candle closes green above SMA support", () => {
      expect(dashboardSrc).toContain("const isTradeReady =");
      expect(dashboardSrc).toContain("is1HGreenAboveSupport");
      expect(dashboardSrc).toContain("isWithinChaseBuffer");
    });

    it("unlocks [ ARM TRADE ] and [ FIDELITY TICKET ] buttons with opacity-100 and hover glow when ready", () => {
      expect(dashboardSrc).toContain('data-testid="button-arm-practice-trade"');
      expect(dashboardSrc).toContain('disabled={!isTradeReady}');
      expect(dashboardSrc).toContain("opacity-50 cursor-not-allowed");
      expect(dashboardSrc).toContain("opacity-100 bg-[#00E676]");
      expect(dashboardSrc).toContain('data-testid="button-execute-fidelity-ticket"');
      expect(dashboardSrc).toContain('data-testid="button-fidelity-ticket-card"');
    });
  });

  describe("3. Relax the 'Entry Missed' Auto-Lock (The Chase Buffer)", () => {
    it("implements maxChaseBuffer equal to 0.20% of asset price or 15% of asset ATR", () => {
      // 0.20% of $200 = $0.40
      const bufferPct = calculateMaxChaseBuffer({ entryPrice: 200, atr: 1.0 });
      expect(bufferPct).toBe(0.4); // 200 * 0.002 = 0.40 > 1.0 * 0.15 = 0.15

      // 15% of ATR $10 = $1.50 vs 0.20% of $500 = $1.00 -> takes $1.50
      const bufferAtr = calculateMaxChaseBuffer({ entryPrice: 500, atr: 10.0 });
      expect(bufferAtr).toBe(1.5);
    });

    it("allows execution within the relaxed chase buffer zone", () => {
      const entryPrice = 200.0;
      const atr = 4.0; // 15% of 4.0 = 0.60
      // maxChaseBuffer = Math.max(0.40, 0.60) = 0.60
      // Price at 200.45 is within buffer
      const res = evaluateEntryChaseStatus({
        entryPrice,
        currentPrice: 200.45,
        atr,
      });
      expect(res.isWithinChaseBuffer).toBe(true);
      expect(res.isEntryMissed).toBe(false);
      expect(res.isMarketExecutionDisabled).toBe(false);
      expect(res.chaseStatusBadge).toBe("[ GREEN / READY TO ARM ]");
    });

    it("locks card and flags NOT TRADEABLE YET - ENTRY MISSED only when price escapes beyond buffer", () => {
      const entryPrice = 200.0;
      const atr = 4.0; // maxChaseBuffer = 0.60, maxAllowed = 200.60
      // Price at 201.50 exceeds buffer
      const res = evaluateEntryChaseStatus({
        entryPrice,
        currentPrice: 201.5,
        atr,
      });
      expect(res.isWithinChaseBuffer).toBe(false);
      expect(res.isEntryMissed).toBe(true);
      expect(res.isMarketExecutionDisabled).toBe(true);
      expect(res.notTradeableReason).toBe("NOT TRADEABLE YET - ENTRY MISSED");
      expect(TRADE_NOT_TRADEABLE_ENTRY_MISSED_BADGE).toBe("NOT TRADEABLE YET - ENTRY MISSED");

      const readiness = evaluateTradeReadiness({
        symbol: "SMH",
        status: "Ready",
        entryPrice,
        currentPrice: 201.5,
        atr,
      });
      expect(readiness.isEntryMissed).toBe(true);
      expect(readiness.isTradeConfirmed).toBe(false);
      expect(readiness.lockMessage).toContain("NOT TRADEABLE YET - ENTRY MISSED");
    });
  });
});

