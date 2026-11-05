import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  EXECUTION_ZONE_PROXIMITY_THRESHOLD,
  getSetupAlertState,
  updateSetup,
  resetSetupAlertState,
  evaluateSetupAlertResetConditions,
  evaluateExecutionZoneAlertGate,
  dispatchServerSetupAlert,
  clearNotificationAuditLog,
} from "../../server/backendNotificationWorker";
import { clearEmailAlertDeduplicationCache } from "../../server/sendEmailAlert";
import {
  STRICT_EXECUTION_ZONE_PROXIMITY_PCT,
  evaluateExecutionZoneProximityFilter,
  evaluateProximityAlertTrigger,
} from "../../client/src/hooks/useProximityAlert";
import { evaluatePreEntryAlertTriggers } from "../../client/src/hooks/useOffScreenPreEntryAlerts";
import { marketDataStore } from "../../client/src/lib/useMarketDataStore";

const rootDir = path.resolve(__dirname, "../..");

describe("Notification Engine Refactor — Alert Deduplication & Strict Proximity Gating", () => {
  beforeEach(() => {
    clearNotificationAuditLog();
    clearEmailAlertDeduplicationCache();
    marketDataStore.clearData("NVDA");
    marketDataStore.resetSetupAlert("NVDA");
    marketDataStore.resetSetupAlert("AAPL");
    marketDataStore.resetSetupAlert("XLV");
  });

  describe("1. Alert Deduplication (Fire Only Once per Setup)", () => {
    it("tracks alertSent: boolean and lastAlertTimestamp in both Global Store and Backend state", () => {
      // Initial state is alertSent: false
      const backendInitial = getSetupAlertState("NVDA");
      expect(backendInitial.alertSent).toBe(false);
      expect(backendInitial.lastAlertTimestamp).toBeNull();

      const storeInitial = marketDataStore.getSetupAlertState("NVDA");
      expect(storeInitial.alertSent).toBe(false);
      expect(storeInitial.lastAlertTimestamp).toBeNull();

      // Update setup when alert is sent
      const updatedBackend = updateSetup("NVDA", { alertSent: true });
      expect(updatedBackend.alertSent).toBe(true);
      expect(updatedBackend.lastAlertTimestamp).toBeGreaterThan(0);

      const updatedStore = marketDataStore.updateSetup("NVDA", { alertSent: true });
      expect(updatedStore.alertSent).toBe(true);
      expect(updatedStore.lastAlertTimestamp).toBeGreaterThan(0);
    });

    it("enforces strict gate: if (setupIsReady && !setup.alertSent) { sendAlert(); updateSetup({ alertSent: true }); }", async () => {
      // First dispatch when setup is ready and !setup.alertSent -> sends alert and sets alertSent: true
      const first = await dispatchServerSetupAlert({
        symbol: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        currentPrice: 135.1,
        sma20: 135.0,
        isTradeConfirmed: true,
        alertType: "CONFIRMED_1H_20SMA",
        barTimestamp: 1700000000,
      });

      expect(first.ok).toBe(true);
      expect(first.suppressed).toBe(false);
      expect(first.alertSent).toBe(true);
      expect(getSetupAlertState("NVDA").alertSent).toBe(true);

      // Second tick on the same setup -> suppressed because setup.alertSent === true
      const second = await dispatchServerSetupAlert({
        symbol: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        currentPrice: 135.15,
        sma20: 135.0,
        isTradeConfirmed: true,
        alertType: "CONFIRMED_1H_20SMA",
        barTimestamp: 1700003600, // Even on a subsequent bar/loop, same setup remains deduplicated
      });

      expect(second.suppressed).toBe(true);
      expect(second.alertSent).toBe(true);
    });

    it("resets alertSent to false ONLY on setup invalidation (< stopLoss), trade close-out, or a new trading day", () => {
      updateSetup("AAPL", { alertSent: true, stopLoss: 220.0 });
      expect(getSetupAlertState("AAPL").alertSent).toBe(true);

      // Normal tick above stopLoss on the same trading day does NOT reset alertSent
      const stillValid = evaluateSetupAlertResetConditions({
        symbol: "AAPL",
        currentPrice: 225.0,
        stopLoss: 220.0,
        status: "Ready",
      });
      expect(stillValid.alertSent).toBe(true);

      // 1. Setup invalidates when currentPrice drops below stopLoss ($219.50 < $220.00)
      const invalidated = evaluateSetupAlertResetConditions({
        symbol: "AAPL",
        currentPrice: 219.5,
        stopLoss: 220.0,
        status: "Ready",
      });
      expect(invalidated.alertSent).toBe(false);
      expect(invalidated.lastAlertTimestamp).toBeNull();

      // Re-arm alertSent and test 2. Trade gets closed out
      updateSetup("AAPL", { alertSent: true, stopLoss: 220.0 });
      expect(getSetupAlertState("AAPL").alertSent).toBe(true);
      const closedOut = evaluateSetupAlertResetConditions({
        symbol: "AAPL",
        currentPrice: 230.0,
        stopLoss: 220.0,
        status: "CLOSED",
      });
      expect(closedOut.alertSent).toBe(false);

      // Re-arm alertSent on Day 1 and test 3. New trading day begins
      const day1 = new Date("2026-11-05T14:30:00Z");
      const day2 = new Date("2026-11-06T14:30:00Z");
      resetSetupAlertState("AAPL", "INVALIDATED", day1);
      updateSetup("AAPL", { alertSent: true, tradingDay: "2026-11-05" });
      expect(getSetupAlertState("AAPL", day1).alertSent).toBe(true);

      const nextTradingDayState = getSetupAlertState("AAPL", day2);
      expect(nextTradingDayState.alertSent).toBe(false);
      expect(nextTradingDayState.lastAlertTimestamp).toBeNull();
    });
  });

  describe("2. Strict 'Execution Zone' Proximity Filter (Condition A & Condition B)", () => {
    it("enforces 0.5% (0.005) strict proximity threshold constant", () => {
      expect(EXECUTION_ZONE_PROXIMITY_THRESHOLD).toBe(0.005);
      expect(STRICT_EXECUTION_ZONE_PROXIMITY_PCT).toBe(0.5);
    });

    it("Condition A (Trigger Confirmed): fires instantly when 1H candle closes green off SMA/EMA and isTradeConfirmed === true", () => {
      const gate = evaluateExecutionZoneAlertGate({
        symbol: "SMH",
        currentPrice: 252.0,
        sma20: 249.0, // > 0.5% away after strong 1H green close bounce
        stopLoss: 245.0,
        isTradeConfirmed: true,
      });

      expect(gate.setupIsReady).toBe(true);
      expect(gate.shouldFire).toBe(true);
      expect(gate.conditionMet).toBe("CONDITION_A_TRIGGER_CONFIRMED");
    });

    it("Condition B (Proximity Warning): fires when live price pulls back strictly within 0.5% of SMA 20 or EMA 10", () => {
      // Price $200.80 vs SMA 20 $200.00 -> 0.40% away (<= 0.5%)
      const sma20Gate = evaluateExecutionZoneAlertGate({
        symbol: "QQQ",
        currentPrice: 200.8,
        sma20: 200.0,
        ema10: 204.0,
        stopLoss: 196.0,
        isTradeConfirmed: false,
      });
      expect(sma20Gate.setupIsReady).toBe(true);
      expect(sma20Gate.shouldFire).toBe(true);
      expect(sma20Gate.conditionMet).toBe("CONDITION_B_PROXIMITY_05_PCT");

      // Price $150.60 vs EMA 10 $150.00 -> 0.40% away (<= 0.5%) while SMA 20 is $144.00
      const ema10Gate = evaluateExecutionZoneAlertGate({
        symbol: "NVDA",
        currentPrice: 150.6,
        sma20: 144.0,
        ema10: 150.0,
        stopLoss: 147.5,
        isTradeConfirmed: false,
      });
      expect(ema10Gate.setupIsReady).toBe(true);
      expect(ema10Gate.shouldFire).toBe(true);
      expect(ema10Gate.conditionMet).toBe("CONDITION_B_PROXIMITY_05_PCT");
    });

    it("blocks alerts for setups that are simply 'Forming' or sitting on Watchlist out of range (> 0.5% away and not confirmed)", async () => {
      // Price $203.00 vs SMA 20 $200.00 -> 1.50% away (> 0.5%), status = "Forming", isTradeConfirmed = false
      const gate = evaluateExecutionZoneAlertGate({
        symbol: "XLV",
        currentPrice: 203.0,
        sma20: 200.0,
        ema10: 201.5, // 0.74% away (> 0.5%)
        stopLoss: 196.0,
        isTradeConfirmed: false,
        status: "Forming",
      });

      expect(gate.setupIsReady).toBe(false);
      expect(gate.shouldFire).toBe(false);
      expect(gate.conditionMet).toBeNull();

      // Client-side filter & pre-entry evaluator also block out-of-range Forming setups
      const clientFilter = evaluateExecutionZoneProximityFilter({
        ticker: "XLV",
        currentPrice: 203.0,
        sma20: 200.0,
        ema10: 201.5,
        stopLoss: 196.0,
        isTradeConfirmed: false,
      });
      expect(clientFilter.setupIsReady).toBe(false);
      expect(clientFilter.shouldFire).toBe(false);

      const preEntryEval = evaluatePreEntryAlertTriggers({
        ticker: "XLV",
        currentPrice: 203.0,
        entryPrice: 200.0,
        target1: 206.0,
        sma20: 200.0,
        ema10: 201.5,
        isTradeConfirmed: false,
        strictExecutionZoneOnly: true,
        status: "Forming",
      });
      expect(preEntryEval.shouldFire).toBe(false);

      const proxEval = evaluateProximityAlertTrigger({
        ticker: "XLV",
        currentPrice: 203.0,
        entryPrice: 200.0,
        sma20: 200.0,
        ema10: 201.5,
        isTradeConfirmed: false,
      });
      expect(proxEval.shouldFire).toBe(false);

      // Server dispatch suppresses out-of-range Forming alert
      const dispatchRes = await dispatchServerSetupAlert({
        symbol: "XLV",
        entryPrice: 200.0,
        stopLoss: 196.0,
        target1: 206.0,
        currentPrice: 203.0,
        sma20: 200.0,
        ema10: 201.5,
        isTradeConfirmed: false,
        status: "Forming",
        alertType: "PROXIMITY_EARLY_WARNING",
      });
      expect(dispatchRes.suppressed).toBe(true);
      expect(getSetupAlertState("XLV").alertSent).toBe(false);
    });
  });

  describe("3. UI Sync: The '[ 🔔 Alert Sent ]' Audit Badge", () => {
    it("passes alertSent: true from backend to frontend Global Store and renders [ 🔔 Alert Sent ] on Setup Cards", async () => {
      const dispatchRes = await dispatchServerSetupAlert({
        symbol: "XLV",
        entryPrice: 148.0,
        stopLoss: 145.5,
        target1: 151.75,
        currentPrice: 148.2,
        sma20: 148.0, // 0.135% <= 0.5%
        isTradeConfirmed: true,
        alertType: "CONFIRMED_1H_20SMA",
      });

      expect(dispatchRes.ok).toBe(true);
      expect(dispatchRes.alertSent).toBe(true);
      expect(dispatchRes.setupState.alertSent).toBe(true);
      expect(dispatchRes.auditEntry.alertSent).toBe(true);
      expect(dispatchRes.auditEntry.badgeText).toContain("[ 🔔 Alert Sent");

      // Sync to frontend global store and verify state
      marketDataStore.updateSetup("XLV", {
        alertSent: dispatchRes.alertSent,
        lastAlertTimestamp: dispatchRes.lastAlertTimestamp,
      });
      expect(marketDataStore.getState().setupAlerts["XLV"]?.alertSent).toBe(true);

      // Verify TradingCard, ActionCenter, and WealthEngineDashboard bind to setupAlerts and render [ 🔔 Alert Sent ]
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );
      const dashboardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/WealthEngineDashboard.tsx"),
        "utf-8"
      );
      const auditHookSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/hooks/useNotificationAuditLog.ts"),
        "utf-8"
      );

      expect(tradingCardSrc).toContain("setupAlertState?.alertSent");
      expect(tradingCardSrc).toContain("[ 🔔 Alert Sent ]");
      expect(dashboardSrc).toContain("marketStore.setupAlerts?.[activeTicker]?.alertSent");
      expect(dashboardSrc).toContain("[ 🔔 Alert Sent ]");
      expect(auditHookSrc).toContain("globalStore.updateSetup");
    });
  });
});

