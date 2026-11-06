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
  formatExecutionReadyAlertMessage,
  dispatchServerSetupAlert,
  clearNotificationAuditLog,
} from "../../server/backendNotificationWorker";
import { clearEmailAlertDeduplicationCache, formatPreEntryEmailHtml } from "../../server/sendEmailAlert";
import {
  STRICT_EXECUTION_ZONE_PROXIMITY_PCT,
  evaluateExecutionZoneProximityFilter,
  evaluateProximityAlertTrigger,
  formatExecutionReadyAlertMessage as formatClientExecutionReadyMessage,
} from "../../client/src/hooks/useProximityAlert";
import {
  evaluatePreEntryAlertTriggers,
  formatPreEntryAlertMessage,
} from "../../client/src/hooks/useOffScreenPreEntryAlerts";
import {
  serverlessPreEntryAlertHandler,
  sendProximityEarlyWarningAlert,
} from "../../server/pre-entry-alerts";
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

      // Price $100.40 vs SMA 50 $100.00 -> 0.40% away (<= 0.5%) while SMA 20 is $95.00
      const sma50Gate = evaluateExecutionZoneAlertGate({
        symbol: "MSFT",
        currentPrice: 100.4,
        sma20: 95.0,
        sma50: 100.0,
        ema10: 98.0,
        stopLoss: 97.0,
        isTradeConfirmed: false,
      });
      expect(sma50Gate.setupIsReady).toBe(true);
      expect(sma50Gate.shouldFire).toBe(true);
      expect(sma50Gate.conditionMet).toBe("CONDITION_B_PROXIMITY_05_PCT");
    });

    it("suppresses and drops all alerts for general 'Watch', 'No Trade', 'Forming', or background scanning logs", async () => {
      // Out of range (price $203 vs SMA 20 $200 -> 1.5% away)
      for (const nonActionableStatus of ["Watch", "No Trade", "Forming", "BACKGROUND_SCAN", "SCANNING"]) {
        const suppressed = evaluateExecutionZoneAlertGate({
          symbol: "AAPL",
          currentPrice: 203.0,
          sma20: 200.0,
          sma50: 195.0,
          ema10: 201.5,
          stopLoss: 196.0,
          isTradeConfirmed: false,
          status: nonActionableStatus,
        });
        expect(suppressed.setupIsReady).toBe(false);
        expect(suppressed.shouldFire).toBe(false);
        expect(suppressed.conditionMet).toBeNull();
      }

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

  describe("4. UI Text Contrast: Dropdown & Search Input Fields", () => {
    it("enforces dark dropdown containers (bg-gray-900 text-white) and prevents Chromium OS option inversion", () => {
      const indexCss = fs.readFileSync(path.resolve(rootDir, "client/src/index.css"), "utf-8");
      expect(indexCss).toContain("color-scheme: dark !important;");
      expect(indexCss).toContain("background-color: #111827 !important;");
      expect(indexCss).toContain("color: #ffffff !important;");
      expect(indexCss).toContain("--popover: 222 47% 11%;");
    });

    it("enforces high-contrast search input styles across Watchlist, SwingWorkspace, and Cockpit", () => {
      const swingWorkspaceSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/SwingWorkspace.tsx"),
        "utf-8"
      );
      const watchlistSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/Watchlist.tsx"),
        "utf-8"
      );
      const dashboardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/WealthEngineDashboard.tsx"),
        "utf-8"
      );

      // SwingWorkspace search/add input
      expect(swingWorkspaceSrc).toContain('data-testid="input-add-ticker"');
      expect(swingWorkspaceSrc).toContain("bg-yellow-400");
      expect(swingWorkspaceSrc).toContain("text-gray-900");
      expect(swingWorkspaceSrc).toContain("placeholder-gray-700");

      // Watchlist page search input
      expect(watchlistSrc).toContain('data-testid="input-add-symbol"');
      expect(watchlistSrc).toContain("bg-yellow-400");
      expect(watchlistSrc).toContain("text-gray-900");
      expect(watchlistSrc).toContain("placeholder-gray-700");

      // WealthEngineDashboard search input
      expect(dashboardSrc).toContain('placeholder="Search/Add Symbol..."');
      expect(dashboardSrc).toContain("bg-yellow-400");
      expect(dashboardSrc).toContain("text-gray-900");
      expect(dashboardSrc).toContain("placeholder-gray-700");
    });
  });

  describe("5. Clear, Actionable Message Formatting (Prop-Desk Terminal Style)", () => {
    it("formats Condition A (Trade Confirmed) message strictly adhering to prop-desk terminal standard", () => {
      const msg = formatExecutionReadyAlertMessage({
        ticker: "NVDA",
        status: "CONFIRMED_1H_CLOSE",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        target2: 140.0,
      });

      expect(msg).toContain("🚨 CHIZZLE EXECUTION READY: [NVDA]");
      expect(msg).toContain("Status: [ CONFIRMED 1H CLOSE ]");
      expect(msg).toContain("Core Math: Entry $135.00 | Stop $132.50 | Target 1 (1.5R) $138.75 | Target 2 (2.0R) $140.00");
      expect(msg).toContain("Actionable Note: Review Fidelity Guide and prepare limit order.");
    });

    it("formats Condition B (Close Proximity / Almost Ready) message strictly adhering to prop-desk terminal standard", () => {
      const msg = formatExecutionReadyAlertMessage({
        ticker: "QQQ",
        status: "PROXIMITY_ALERT_05_PCT",
        entryPrice: 200.0,
        stopLoss: 196.0,
        target1: 206.0,
        target2: 208.0,
      });

      expect(msg).toContain("🚨 CHIZZLE EXECUTION READY: [QQQ]");
      expect(msg).toContain("Status: [ PROXIMITY ALERT < 0.5% ]");
      expect(msg).toContain("Core Math: Entry $200.00 | Stop $196.00 | Target 1 (1.5R) $206.00 | Target 2 (2.0R) $208.00");
      expect(msg).toContain("Actionable Note: Review Fidelity Guide and prepare limit order.");
    });

    it("dispatches server setup alerts with prop-desk formatted message in audit entry", async () => {
      const res = await dispatchServerSetupAlert({
        symbol: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        currentPrice: 135.1,
        sma20: 135.0,
        isTradeConfirmed: true,
        force: true,
      });

      expect(res.ok).toBe(true);
      expect(res.suppressed).toBe(false);
      expect(res.auditEntry.message).toContain("🚨 CHIZZLE EXECUTION READY: [NVDA]");
      expect(res.auditEntry.message).toContain("Status: [ CONFIRMED 1H CLOSE ]");
      expect(res.auditEntry.message).toContain("Core Math: Entry $135.00 | Stop $132.50 | Target 1 (1.5R) $138.75 | Target 2 (2.0R) $140.00");
      expect(res.auditEntry.message).toContain("Actionable Note: Review Fidelity Guide and prepare limit order.");
    });
  });

  describe("6. Accurate Share Sizing & Fidelity Ticket Formatting Across Telegram and Email Alerts", () => {
    it("formats Fidelity Ticket in Telegram message with exact calculatedShares from live risk math", () => {
      // 11 shares calculation (e.g. $25k equity, 0.11% risk, or custom user risk sizing)
      const msg = formatExecutionReadyAlertMessage({
        ticker: "NVDA",
        status: "CONFIRMED_1H_CLOSE",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        calculatedShares: 11,
      });

      expect(msg).toContain("Fidelity Ticket: BUY 11 Shares Limit at $135.00. Order 1 SELL 5 Shares @ $138.75 (1.5R) | Order 2 STOP 6 Shares @ $132.50.");

      // Also verify client-side helper produces the exact same ticket
      const clientMsg = formatClientExecutionReadyMessage({
        ticker: "NVDA",
        status: "CONFIRMED_1H_CLOSE",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        calculatedShares: 11,
      });
      expect(clientMsg).toContain("Fidelity Ticket: BUY 11 Shares Limit at $135.00. Order 1 SELL 5 Shares @ $138.75 (1.5R) | Order 2 STOP 6 Shares @ $132.50.");

      // 77 shares calculation
      const msg77 = formatExecutionReadyAlertMessage({
        ticker: "AAPL",
        status: "PROXIMITY_ALERT_05_PCT",
        entryPrice: 220.0,
        stopLoss: 215.0,
        target1: 227.5,
        calculatedShares: 77,
      });
      expect(msg77).toContain("Fidelity Ticket: BUY 77 Shares Limit at $220.00. Order 1 SELL 38 Shares @ $227.50 (1.5R) | Order 2 STOP 39 Shares @ $215.00.");
    });

    it("formats Pre-Entry lock-screen / Telegram message with exact shares when provided", () => {
      const msgWithShares = formatPreEntryAlertMessage({
        ticker: "NVDA",
        entryPrice: 135.0,
        target1: 138.75,
        stopLoss: 132.5,
        calculatedShares: 15,
        context: "Price within 0.25% of SMA",
      });
      expect(msgWithShares).toContain("Fidelity Plan: BUY 15 Shares Limit at $135.00. Order 1 SELL 7 Shares @ $138.75 (1.5R) | Order 2 STOP 8 Shares @ $132.50");

      const msgWithoutShares = formatPreEntryAlertMessage({
        ticker: "NVDA",
        entryPrice: 135.0,
        target1: 138.75,
        context: "Price within 0.25% of SMA",
      });
      expect(msgWithoutShares).toContain("Fidelity Plan: Limit BUY at $135.00. Scale 50% at $138.75.");
    });

    it("formats Pre-Entry Email HTML with exact live share count and prevents [object Object] artifacts", () => {
      const emailResult = formatPreEntryEmailHtml({
        ticker: "NVDA",
        entryPrice: 135.0,
        target1: 138.75,
        stopLoss: 132.5,
        calculatedShares: 11,
        context: "3 mins to 1H Close",
      });

      expect(emailResult.html).not.toContain("[object Object]");
      expect(emailResult.text).not.toContain("[object Object]");
      expect(emailResult.html).toContain("BUY 11 Shares Limit at $135.00. Order 1 SELL 5 Shares @ $138.75 (1.5R) | Order 2 STOP 6 Shares @ $132.50");
      expect(emailResult.html).toContain("🎯 Order Size: 11 Shares");

      // Verify it handles plan passed as an object gracefully without rendering [object Object]
      const objectPlanEmail = formatPreEntryEmailHtml({
        ticker: "NVDA",
        entryPrice: 135.0,
        target1: 138.75,
        stopLoss: 132.5,
        plan: { shares: 20, entryPrice: 135.0, stopLoss: 132.5, target1: 138.75 },
        context: "Price within 0.25% of SMA",
      });

      expect(objectPlanEmail.html).not.toContain("[object Object]");
      expect(objectPlanEmail.html).toContain("BUY 20 Shares Limit at $135.00. Order 1 SELL 10 Shares @ $138.75 (1.5R) | Order 2 STOP 10 Shares @ $132.50");
      expect(objectPlanEmail.html).toContain("🎯 Order Size: 20 Shares");
    });

    it("sendProximityEarlyWarningAlert builds ticket with exact calculatedShares", async () => {
      const res = await sendProximityEarlyWarningAlert({
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        calculatedShares: 18,
      });

      expect(res.ok).toBe(true);
      expect(res.message).toContain("BUY 18 Shares Limit at $135.00. Order 1 SELL 9 Shares @ $138.75 (1.5R) | Order 2 STOP 9 Shares @ $132.50.");
    });

    it("serverlessPreEntryAlertHandler formats alert with exact calculatedShares from payload", async () => {
      const res = await serverlessPreEntryAlertHandler({
        ticker: "NVDA",
        entryPrice: 135.0,
        stopLoss: 132.5,
        target1: 138.75,
        calculatedShares: 25,
      });

      expect(res.ok).toBe(true);
      expect(res.message).toContain("BUY 25 Shares Limit at $135.00. Order 1 SELL 12 Shares @ $138.75 (1.5R) | Order 2 STOP 13 Shares @ $132.50.");
    });

    it("verifies WealthEngineDashboard synchronizes cardSizing.calculatedShares into both alert hooks", () => {
      const dashboardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/WealthEngineDashboard.tsx"),
        "utf-8"
      );

      // Verify useOffScreenPreEntryAlerts receives cardSizing.calculatedShares
      expect(dashboardSrc).toMatch(/useOffScreenPreEntryAlerts\(\{[\s\S]*?calculatedShares:\s*cardSizing\.calculatedShares/);

      // Verify useProximityAlert receives cardSizing.calculatedShares
      expect(dashboardSrc).toMatch(/useProximityAlert\(\{[\s\S]*?calculatedShares:\s*cardSizing\.calculatedShares/);
    });
  });
});

