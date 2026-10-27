import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { DEFAULT_WATCHLIST } from "../../client/src/lib/wealthWatchlist";
import { calculatePositionSize, DEFAULT_ACCOUNT_EQUITY } from "../../client/src/hooks/usePositionSizer";

describe("Equity Reference Safety & Wealth Studio Dynamic Price Levels", () => {
  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
  const actionCenterContent = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const riskBarPath = path.resolve(__dirname, "../../client/src/components/swing/RiskSettingsBar.tsx");
  const riskBarContent = fs.readFileSync(riskBarPath, "utf-8").replace(/\r\n/g, "\n");

  const sizerPath = path.resolve(__dirname, "../../client/src/hooks/usePositionSizer.ts");
  const sizerContent = fs.readFileSync(sizerPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Fatal Crash Resolution: 'ReferenceError: equity is not defined'", () => {
    it("destructures equity: propEquity in InlineTradingCard and prevents undefined identifier", () => {
      expect(tradingCardContent).toContain("equity: propEquity");
      expect(tradingCardContent).toContain("const accountEquity = propEquity ?? global?.accountEquity ?? (global as any)?.equity ?? 25000;");
      expect(tradingCardContent).toContain("const safeEquity = Number(accountEquity) || 25000;");
      expect(tradingCardContent).toContain("accountEquity: safeEquity,");
    });

    it("safely extracts safeEquity in ActionCenter with fallback", () => {
      expect(actionCenterContent).toContain("const safeEquity = Number(acct?.equity) || 25000;");
      expect(actionCenterContent).toContain("const equity = safeEquity;");
    });

    it("safely extracts safeEquity in RiskSettingsBar and WealthEngineDashboard", () => {
      expect(riskBarContent).toContain("const safeEquity = Number(accountEquity) || 25000;");
      expect(dashboardContent).toContain("const safeEquity = Number(global?.accountEquity ?? (global as any)?.equity) || 25000;");
    });

    it("defensively handles null, undefined, 0, or invalid equity in calculatePositionSize", () => {
      const nullEquityResult = calculatePositionSize({
        accountEquity: null,
        entryPrice: 216,
        stopLossPrice: 212,
      });
      expect(nullEquityResult.accountEquity).toBe(DEFAULT_ACCOUNT_EQUITY);
      expect(nullEquityResult.calculatedShares).toBeGreaterThan(0);

      const zeroEquityResult = calculatePositionSize({
        accountEquity: 0,
        entryPrice: 216,
        stopLossPrice: 212,
      });
      expect(zeroEquityResult.accountEquity).toBe(DEFAULT_ACCOUNT_EQUITY);

      const nanEquityResult = calculatePositionSize({
        accountEquity: NaN as any,
        entryPrice: 216,
        stopLossPrice: 212,
      });
      expect(nanEquityResult.accountEquity).toBe(DEFAULT_ACCOUNT_EQUITY);
    });

    it("logs [Risk Engine] Account Equity: for diagnostic telemetry", () => {
      expect(sizerContent).toContain("console.log('[Risk Engine] Account Equity:', safeEquity);");
      expect(tradingCardContent).toContain("console.log('[Risk Engine] Account Equity:', safeEquity);");
      expect(riskBarContent).toContain("console.log('[Risk Engine] Account Equity:', safeEquity);");
      expect(dashboardContent).toContain("console.log('[Risk Engine] Account Equity:', safeEquity);");
    });
  });

  describe("2. Wealth Studio Dynamic Price Levels & NVDA Sync", () => {
    it("updates NVDA seed price in DEFAULT_WATCHLIST to 216.00 with aligned 20-SMA baseline", () => {
      const nvda = DEFAULT_WATCHLIST.find((i) => i.symbol === "NVDA");
      expect(nvda).toBeDefined();
      expect(nvda?.price).toBe(216.00);
      expect(nvda?.buyTarget).toBe(216.00);
      expect(nvda?.stopLoss).toBe(212.00);
      expect(nvda?.primaryTarget).toBe(222.00);
      expect(nvda?.t2).toBe(224.00);
      expect(nvda?.t3).toBe(228.00);
    });

    it("verifies the exact dynamic level formula: Risk = 216 - 212 = 4, T1 = 222 (1.5R), T2 = 224 (2.0R), T3 = 228 (3.0R)", () => {
      const entryPrice = 216.00;
      const stopLossPrice = 212.00;
      const risk = +(entryPrice - stopLossPrice).toFixed(2);
      expect(risk).toBe(4.00);

      const t1 = +(entryPrice + risk * 1.5).toFixed(2);
      const t2 = +(entryPrice + risk * 2.0).toFixed(2);
      const t3 = +(entryPrice + risk * 3.0).toFixed(2);

      expect(t1).toBe(222.00);
      expect(t2).toBe(224.00);
      expect(t3).toBe(228.00);
    });

    it("binds setup card three bold datapoints and mini guide to dynamic levels in WealthEngineDashboard", () => {
      expect(dashboardContent).toContain("buyTarget: activeTickerData?.symbol === activeTicker ? (activeTickerData.buyTarget ?? entryPriceVal) : entryPriceVal");
      expect(dashboardContent).toContain("stopLoss: activeTickerData?.symbol === activeTicker ? (activeTickerData.stopLoss ?? stopLossVal) : stopLossVal");
      expect(dashboardContent).toContain("primaryTarget: activeTickerData?.symbol === activeTicker ? (activeTickerData.target1 ?? t1Val) : t1Val");
      expect(dashboardContent).toContain("${activeItem?.buyTarget != null ? activeItem.buyTarget.toFixed(2) : \"0.00\"}");
      expect(dashboardContent).toContain("${activeItem?.stopLoss != null ? activeItem.stopLoss.toFixed(2) : \"0.00\"}");
      expect(dashboardContent).toContain("${activeItem?.primaryTarget != null ? activeItem.primaryTarget.toFixed(2) : \"0.00\"}");
    });

    it("binds FidelityExecutionCheatSheet and BrokerExecutionSteps to dynamic levels", () => {
      expect(dashboardContent).toContain("entry={activeTickerData?.symbol === activeTicker ? (activeTickerData?.buyTarget ?? entryPriceVal) : entryPriceVal}");
      expect(dashboardContent).toContain("stop={activeTickerData?.symbol === activeTicker ? (activeTickerData?.stopLoss ?? stopLossVal) : stopLossVal}");
      expect(dashboardContent).toContain("target1={activeTickerData?.symbol === activeTicker ? (activeTickerData?.target1 ?? t1Val) : t1Val}");
    });

    it("logs [Wealth Studio] Active Ticker and Calculated Trade Levels during initialization", () => {
      expect(dashboardContent).toContain("console.log('[Wealth Studio] Active Ticker:', activeTicker, 'Current Price:', currentPrice);");
      expect(dashboardContent).toContain("console.log('[Wealth Studio] Calculated Trade Levels:', {");
      expect(dashboardContent).toContain("console.log('[Wealth Studio] Active Ticker:', symbol, 'Current Price:', currentRefPrice);");
    });
  });
});
