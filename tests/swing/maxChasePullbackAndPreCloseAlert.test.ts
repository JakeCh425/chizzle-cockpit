import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  calculateMaxEntryTolerance,
  evaluateEntryChaseStatus,
  evaluateTradeReadiness,
  TRADE_READY_TO_ARM_BADGE,
  TRADE_ENTRY_MISSED_BADGE,
  SET_PULLBACK_LIMIT_LABEL,
} from "../../client/src/hooks/useTradeReadiness";
import {
  evaluatePreCloseAlertWindow,
  playPreCloseAudioChime,
  PRE_CLOSE_ALERT_MESSAGE,
  PRE_CLOSE_TRIGGER_MINUTE,
} from "../../client/src/hooks/usePreCloseAlert";

const dashboardPath = path.resolve(
  __dirname,
  "../../client/src/pages/WealthEngineDashboard.tsx"
);
const dashboardContent = fs.readFileSync(dashboardPath, "utf-8");

const tradingCardPath = path.resolve(
  __dirname,
  "../../client/src/components/swing/TradingCard.tsx"
);
const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8");

describe("Refine Entry Logic — Max Chase Buffer, Automated Pullback Limits & 1H Pre-Close Alert", () => {
  describe("1. Max Chase Proximity Buffer (maxEntryTolerance)", () => {
    it("calculates maxEntryTolerance tied to ATR or 0.15%–0.25% of entry price", () => {
      // Without ATR: defaults to 0.25% of entryPrice ($200 * 0.0025 = $0.50)
      const tolPct = calculateMaxEntryTolerance({ entryPrice: 200 });
      expect(tolPct).toBeCloseTo(0.5, 4);

      // With ATR: bounded within [0.15%, 0.25%] of entryPrice
      const tolAtr = calculateMaxEntryTolerance({ entryPrice: 541.62, atr: 12.8 });
      expect(tolAtr).toBeGreaterThanOrEqual(541.62 * 0.0015);
      expect(tolAtr).toBeLessThanOrEqual(541.62 * 0.0025);
    });

    it("keeps trade [ GREEN / READY TO ARM ] when currentPrice <= entryPrice + maxEntryTolerance", () => {
      // Entry $541.62, maxEntryTolerance = $1.00 -> price at $542.40 is within tolerance
      const withinEval = evaluateEntryChaseStatus({
        entryPrice: 541.62,
        currentPrice: 542.40,
        maxEntryTolerance: 1.0,
      });

      expect(withinEval.isWithinChaseBuffer).toBe(true);
      expect(withinEval.isEntryMissed).toBe(false);
      expect(withinEval.chaseStatusBadge).toBe(TRADE_READY_TO_ARM_BADGE);
      expect(withinEval.chaseStatusBadge).toBe("[ GREEN / READY TO ARM ]");
      expect(withinEval.isMarketExecutionDisabled).toBe(false);
      expect(withinEval.primaryActionLabel).toBe("Arm Trade");

      const readiness = evaluateTradeReadiness({
        symbol: "SMH",
        status: "Ready",
        entryPrice: 541.62,
        currentPrice: 542.40,
        maxEntryTolerance: 1.0,
      });
      expect(readiness.isTradeConfirmed).toBe(true);
      expect(readiness.isEntryMissed).toBe(false);
      expect(readiness.chaseStatusBadge).toBe("[ GREEN / READY TO ARM ]");
    });

    it("flips to [ ENTRY MISSED - DO NOT CHASE ] and disables market execution when currentPrice > entryPrice + maxEntryTolerance", () => {
      // Entry $541.62, maxEntryTolerance = $1.00 -> price at $543.10 exceeds maxAllowedEntryPrice ($542.62)
      const missedEval = evaluateEntryChaseStatus({
        entryPrice: 541.62,
        currentPrice: 543.10,
        maxEntryTolerance: 1.0,
      });

      expect(missedEval.isWithinChaseBuffer).toBe(false);
      expect(missedEval.isEntryMissed).toBe(true);
      expect(missedEval.chaseStatusBadge).toBe(TRADE_ENTRY_MISSED_BADGE);
      expect(missedEval.chaseStatusBadge).toBe("[ ENTRY MISSED - DO NOT CHASE ]");
      expect(missedEval.isMarketExecutionDisabled).toBe(true);
      expect(missedEval.primaryActionLabel).toBe(SET_PULLBACK_LIMIT_LABEL);
      expect(missedEval.primaryActionLabel).toBe("[ SET PULLBACK LIMIT ]");
      expect(missedEval.pullbackLimitPrice).toBe(541.62);

      const readiness = evaluateTradeReadiness({
        symbol: "SMH",
        status: "Ready",
        entryPrice: 541.62,
        currentPrice: 543.10,
        maxEntryTolerance: 1.0,
      });
      expect(readiness.isEntryMissed).toBe(true);
      expect(readiness.isTradeConfirmed).toBe(false); // Market execution disabled!
      expect(readiness.statusBadge.text).toBe("[ ENTRY MISSED - DO NOT CHASE ]");
      expect(readiness.primaryActionLabel).toBe("[ SET PULLBACK LIMIT ]");
      expect(readiness.pullbackLimitPrice).toBe(541.62);
    });
  });

  describe("2. Automated 'Retest' Limit Orders (The Pullback Method)", () => {
    it("renders [ SET PULLBACK LIMIT ] button in Wealth Studio and Action Center cards to stage a limit buy at original entryPrice", () => {
      expect(dashboardContent).toContain('data-testid="button-set-pullback-limit"');
      expect(dashboardContent).toContain("handleStagePullbackLimit");
      expect(dashboardContent).toContain('orderType: "PULLBACK_LIMIT"');
      expect(dashboardContent).toContain('data-testid="staged-pullback-limit-badge"');
      expect(dashboardContent).toContain('data-testid="trade-level-max-chase-buffer"');

      expect(tradingCardContent).toContain("[ SET PULLBACK LIMIT ]");
      expect(tradingCardContent).toContain('f.state === "MISSED_ENTRY"');
    });
  });

  describe("3. Pre-Close Alert System (1H Candle Timing)", () => {
    it("triggers [ ACTION REQUIRED: 1H Candle closing in 3 minutes - Prepare to Arm ] at :57 (e.g., 9:57 AM, 10:57 AM) when a setup is forming", () => {
      expect(PRE_CLOSE_TRIGGER_MINUTE).toBe(57);
      expect(PRE_CLOSE_ALERT_MESSAGE).toBe(
        "[ ACTION REQUIRED: 1H Candle closing in 3 minutes - Prepare to Arm ]"
      );

      // 9:57:10 AM with setup forming -> shouldAlert = true
      const at957Forming = evaluatePreCloseAlertWindow(
        new Date(2026, 9, 27, 9, 57, 10),
        true
      );
      expect(at957Forming.isThreeMinuteWindow).toBe(true);
      expect(at957Forming.minutesRemaining).toBe(3);
      expect(at957Forming.shouldAlert).toBe(true);
      expect(at957Forming.alertMessage).toBe(
        "[ ACTION REQUIRED: 1H Candle closing in 3 minutes - Prepare to Arm ]"
      );

      // 10:57:00 AM with setup forming -> shouldAlert = true
      const at1057Forming = evaluatePreCloseAlertWindow(
        new Date(2026, 9, 27, 10, 57, 0),
        true
      );
      expect(at1057Forming.shouldAlert).toBe(true);
      expect(at1057Forming.hourKey).not.toBe(at957Forming.hourKey);

      // 9:57 AM when setup is NOT forming -> shouldAlert = false
      const at957NotForming = evaluatePreCloseAlertWindow(
        new Date(2026, 9, 27, 9, 57, 10),
        false
      );
      expect(at957NotForming.shouldAlert).toBe(false);

      // 9:45 AM when setup is forming -> shouldAlert = false
      const at945Forming = evaluatePreCloseAlertWindow(
        new Date(2026, 9, 27, 9, 45, 0),
        true
      );
      expect(at945Forming.shouldAlert).toBe(false);
    });

    it("safely handles audio chime playback and renders pre-close-alert-toast in WealthEngineDashboard", () => {
      expect(() => playPreCloseAudioChime()).not.toThrow();
      expect(dashboardContent).toContain('data-testid="pre-close-alert-toast"');
      expect(dashboardContent).toContain('data-testid="button-toggle-pre-close-audio"');
      expect(dashboardContent).toContain("usePreCloseAlert");
    });
  });
});
