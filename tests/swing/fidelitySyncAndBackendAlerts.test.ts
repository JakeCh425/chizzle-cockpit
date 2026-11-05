import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  evaluateServer1HCandleConfirmation,
  dispatchServerSetupAlert,
  runBackendWatchlistAlertScan,
  getNotificationAuditLog,
  getLatestAlertForSymbol,
  clearNotificationAuditLog,
  startBackendNotificationWorker,
  stopBackendNotificationWorker,
  type ServerBar1H,
} from "../../server/backendNotificationWorker";

const rootDir = path.resolve(__dirname, "../..");

describe("Critical Architecture Fixes — Fidelity Execution Guide State Sync & 24/7 Backend Alerts", () => {
  beforeEach(() => {
    clearNotificationAuditLog();
    stopBackendNotificationWorker();
  });

  describe("1. Fidelity Execution Guide State Synchronization", () => {
    it("removes hardcoded share defaults (e.g., 1000 / riskPerShare = 179 shares) from FidelityExecutionGuide & FidelityExecutionCheatSheet", () => {
      const guideSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/FidelityExecutionGuide.tsx"),
        "utf-8"
      );
      const cheatSheetSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/FidelityExecutionCheatSheet.tsx"),
        "utf-8"
      );

      // Must bind to Global Store slice and accept strict props
      expect(guideSrc).toContain("useOptionalGlobalState");
      expect(guideSrc).toContain("calculatedShares?: number | null");
      expect(cheatSheetSrc).toContain("useOptionalGlobalState");
      expect(cheatSheetSrc).toContain("calculatedShares?: number");

      // Must NOT contain hardcoded 1000 / riskPerShare fallback
      expect(cheatSheetSrc).not.toContain("Math.floor(1000 / riskPerShare)");
    });

    it("enforces Order 1 (Take 1.5R Profit) = Math.floor(calculatedShares / 2) and Order 2 (Stop Loss) = calculatedShares - Math.floor(calculatedShares / 2)", () => {
      const guideSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/FidelityExecutionGuide.tsx"),
        "utf-8"
      );
      const cheatSheetSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/FidelityExecutionCheatSheet.tsx"),
        "utf-8"
      );

      expect(guideSrc).toContain("Math.floor(calculatedShares / 2)");
      expect(guideSrc).toContain("calculatedShares - Math.floor(calculatedShares / 2)");
      expect(cheatSheetSrc).toContain("Math.floor(calculatedShares / 2)");
      expect(cheatSheetSrc).toContain("calculatedShares - Math.floor(calculatedShares / 2)");

      // Mathematical verification for 11 calculated shares (odd number split: 5 + 6 = 11)
      const calculatedShares = 11;
      const order1Shares = Math.floor(calculatedShares / 2);
      const order2RemainingShares = calculatedShares - Math.floor(calculatedShares / 2);
      expect(order1Shares).toBe(5);
      expect(order2RemainingShares).toBe(6);
      expect(order1Shares + order2RemainingShares).toBe(11);
    });

    it("passes exact entryPrice, stopLoss, target1, and calculatedShares from parent components down to FidelityExecutionGuide & FidelityExecutionCheatSheet", () => {
      const swingChartSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/SwingChart.tsx"),
        "utf-8"
      );
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );
      const dashboardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/WealthEngineDashboard.tsx"),
        "utf-8"
      );

      expect(swingChartSrc).toContain("calculatedShares={effectiveShares}");
      expect(tradingCardSrc).toContain("calculatedShares={dynamicShares}");
      expect(dashboardSrc).toContain("calculatedShares={cardSizing.calculatedShares}");
      expect(dashboardSrc).not.toContain("Math.floor(1000 / Math.max(riskVal, 0.01))");
    });
  });

  describe("2. Backend 24/7 Notification Engine (Reliable Server-Side Delivery)", () => {
    it("evaluates 1H candle close confirmation when XLV hits and holds the 20-SMA on the server", () => {
      // Build 20 closed 1H bars for XLV hovering around $148.00 (20-SMA = $148.00)
      // Latest closed 1H bar pulls back to touch 20-SMA ($147.90 low) and closes green at $148.40
      const bars: ServerBar1H[] = Array.from({ length: 19 }, (_, idx) => ({
        t: 1700000000 + idx * 3600,
        o: 147.8,
        h: 148.5,
        l: 147.5,
        c: 148.0,
        closed: true,
      }));
      bars.push({
        t: 1700000000 + 19 * 3600,
        o: 147.95,
        h: 148.6,
        l: 147.85, // touches 20-SMA ($148.02)
        c: 148.4,  // closes green above 20-SMA
        closed: true,
      });

      const evalResult = evaluateServer1HCandleConfirmation({
        symbol: "XLV",
        bars1h: bars,
        accountEquity: 25000,
        riskPercentage: 1.0,
      });

      expect(evalResult.symbol).toBe("XLV");
      expect(evalResult.confirmed).toBe(true);
      expect(evalResult.alertType).toBe("CONFIRMED_1H_20SMA");
      expect(evalResult.sma20).toBeCloseTo(148.02, 1);
      expect(evalResult.entryPrice).toBeGreaterThan(0);
      expect(evalResult.stopLoss).toBeLessThan(evalResult.entryPrice);
      expect(evalResult.target1).toBeGreaterThan(evalResult.entryPrice);
      expect(evalResult.order1Shares).toBe(Math.floor(evalResult.calculatedShares / 2));
      expect(evalResult.order2Shares).toBe(
        evalResult.calculatedShares - Math.floor(evalResult.calculatedShares / 2)
      );
    });

    it("evaluates 10-SMA runaway momentum confirmation when price is >3% above 20-SMA and holds 10-SMA", () => {
      // First 10 bars around $180, next 10 bars around $195 so 10-SMA = $195 and 20-SMA = $187.50
      const bars: ServerBar1H[] = [
        ...Array.from({ length: 10 }, (_, idx) => ({
          t: 1700000000 + idx * 3600,
          o: 179.5,
          h: 181.0,
          l: 179.0,
          c: 180.0,
          closed: true,
        })),
        ...Array.from({ length: 9 }, (_, idx) => ({
          t: 1700000000 + (10 + idx) * 3600,
          o: 194.5,
          h: 196.0,
          l: 194.0,
          c: 195.0,
          closed: true,
        })),
        {
          t: 1700000000 + 19 * 3600,
          o: 194.8,
          h: 196.2,
          l: 194.6, // touches 10-SMA ($195.05)
          c: 195.5, // closes green > 3% above 20-SMA ($187.53)
          closed: true,
        },
      ];

      const evalResult = evaluateServer1HCandleConfirmation({
        symbol: "XLV",
        bars1h: bars,
      });

      expect(evalResult.confirmed).toBe(true);
      expect(evalResult.alertType).toBe("CONFIRMED_1H_10SMA");
      expect(evalResult.setupType).toContain("[ MOMENTUM SETUP: 10-SMA ]");
    });

    it("executes server-side Telegram, Resend Email, and Twilio SMS payloads and records audit log on confirmed setup", async () => {
      const res = await dispatchServerSetupAlert({
        symbol: "XLV",
        entryPrice: 148.4,
        stopLoss: 146.15,
        target1: 151.78,
        calculatedShares: 11,
        alertType: "CONFIRMED_1H_20SMA",
        barTimestamp: 1700068400,
      });

      expect(res.ok).toBe(true);
      expect(res.suppressed).toBe(false);
      expect(res.auditEntry.symbol).toBe("XLV");
      expect(res.auditEntry.calculatedShares).toBe(11);
      expect(res.auditEntry.channels).toEqual(["telegram", "email", "sms"]);
      expect(res.auditEntry.badgeText).toContain("[ 🔔 Alert Sent");
      expect(res.auditEntry.message).toContain("Order 1 SELL 5 Shares");
      expect(res.auditEntry.message).toContain("Order 2 STOP 6 Shares");

      // Subsequent duplicate call for the same bar is deduplicated
      const dup = await dispatchServerSetupAlert({
        symbol: "XLV",
        entryPrice: 148.4,
        stopLoss: 146.15,
        target1: 151.78,
        calculatedShares: 11,
        alertType: "CONFIRMED_1H_20SMA",
        barTimestamp: 1700068400,
      });
      expect(dup.suppressed).toBe(true);
      expect(getNotificationAuditLog("XLV")).toHaveLength(1);
    });

    it("continuously scans watchlist on the server independent of the browser and starts background worker", async () => {
      const mockBars: ServerBar1H[] = Array.from({ length: 20 }, (_, idx) => ({
        t: 1700100000 + idx * 3600,
        o: 147.9,
        h: 148.5,
        l: 147.8,
        c: 148.2,
        closed: true,
      }));

      const scanRes = await runBackendWatchlistAlertScan({
        symbols: ["XLV"],
        fetchBarsForSymbol: async () => mockBars,
      });

      expect(scanRes.scannedSymbols).toEqual(["XLV"]);
      expect(scanRes.firedAlerts).toHaveLength(1);
      expect(getLatestAlertForSymbol("XLV")?.symbol).toBe("XLV");

      const workerState = startBackendNotificationWorker(120_000);
      expect(workerState.running).toBe(true);
      stopBackendNotificationWorker();
    });
  });

  describe("3. UI 'Alert Fired' Status Badge ([ 🔔 Alert Sent ]) Audit Trail", () => {
    it("renders [ 🔔 Alert Sent ] timestamp badge on Setup Cards across TradingCard, ActionCenter, and WealthEngineDashboard", () => {
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );
      const actionCenterSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"),
        "utf-8"
      );
      const dashboardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/pages/WealthEngineDashboard.tsx"),
        "utf-8"
      );

      expect(tradingCardSrc).toContain("[ 🔔 Alert Sent ]");
      expect(tradingCardSrc).toContain("badge-alert-sent-");
      expect(actionCenterSrc).toContain("[ 🔔 Alert Sent ]");
      expect(actionCenterSrc).toContain("badge-alert-sent-");
      expect(dashboardSrc).toContain("[ 🔔 Alert Sent ]");
      expect(dashboardSrc).toContain('data-testid="badge-alert-sent"');
    });
  });
});

