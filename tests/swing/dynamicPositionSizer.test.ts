import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { calculatePositionSize, DEFAULT_ACCOUNT_EQUITY, DEFAULT_RISK_PERCENTAGE } from "../../client/src/hooks/usePositionSizer";

describe("Dynamic Risk-Based Position Sizer & Card Integration", () => {
  const sizerHookPath = path.resolve(__dirname, "../../client/src/hooks/usePositionSizer.ts");
  const sizerHookContent = fs.readFileSync(sizerHookPath, "utf-8").replace(/\r\n/g, "\n");

  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateContent = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const riskBarPath = path.resolve(__dirname, "../../client/src/components/swing/RiskSettingsBar.tsx");
  const riskBarContent = fs.readFileSync(riskBarPath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
  const tradingCardContent = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");

  const fidelityGuidePath = path.resolve(__dirname, "../../client/src/components/FidelityExecutionGuide.tsx");
  const fidelityGuideContent = fs.readFileSync(fidelityGuidePath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Mathematical Logic Hook (usePositionSizer / calculatePositionSize)", () => {
    it("uses exact default parameters: $25,000 equity and 1.0% risk", () => {
      expect(DEFAULT_ACCOUNT_EQUITY).toBe(25000);
      expect(DEFAULT_RISK_PERCENTAGE).toBe(1.0);

      const res = calculatePositionSize({
        entryPrice: 100,
        stopLossPrice: 95,
      });

      expect(res.accountEquity).toBe(25000);
      expect(res.riskPercentage).toBe(1.0);
      expect(res.dollarRiskPerShare).toBe(5.0);
      expect(res.totalDollarRiskAllowed).toBe(250.0);
      expect(res.calculatedShares).toBe(50); // 250 / 5 = 50
      expect(res.totalCapitalRequired).toBe(5000); // 50 * 100
      expect(res.portfolioAllocationPercent).toBe(20.0); // 5000 / 25000 * 100
      expect(res.t1Shares).toBe(25); // floor(50 / 2)
      expect(res.t2Shares).toBe(25); // 50 - 25
      expect(res.isMarginRequired).toBe(false);
      expect(res.warningMessage).toBeNull();
    });

    it("calculates exact shares and scale-out split for odd share counts", () => {
      // Equity: $10,000, 1.5% Risk ($150 total risk allowed)
      // Entry: $50, Stop: $42.50 ($7.50 risk per share)
      // Shares = floor(150 / 7.50) = 20
      const res = calculatePositionSize({
        accountEquity: 10000,
        riskPercentage: 1.5,
        entryPrice: 50,
        stopLossPrice: 42.5,
      });

      expect(res.totalDollarRiskAllowed).toBe(150);
      expect(res.dollarRiskPerShare).toBe(7.5);
      expect(res.calculatedShares).toBe(20);
      expect(res.t1Shares).toBe(10);
      expect(res.t2Shares).toBe(10);

      // Odd share count: e.g. 7 shares
      // Equity: $10,000, 0.7% Risk ($70)
      // Entry: $100, Stop: $90 ($10 risk per share) -> 7 shares
      const resOdd = calculatePositionSize({
        accountEquity: 10000,
        riskPercentage: 0.7,
        entryPrice: 100,
        stopLossPrice: 90,
      });

      expect(resOdd.calculatedShares).toBe(7);
      expect(resOdd.t1Shares).toBe(3); // floor(7 / 2) = 3
      expect(resOdd.t2Shares).toBe(4); // 7 - 3 = 4
      expect(resOdd.t1Shares + resOdd.t2Shares).toBe(7);
    });

    it("triggers margin required warning when total capital required exceeds account equity", () => {
      // Equity: $5,000, 2.0% Risk ($100 risk allowed)
      // High price stock: Entry: $500, Stop: $495 ($5 risk per share)
      // Calculated shares = floor(100 / 5) = 20 shares
      // Total capital required = 20 * 500 = $10,000 (exceeds $5,000 equity!)
      const res = calculatePositionSize({
        accountEquity: 5000,
        riskPercentage: 2.0,
        entryPrice: 500,
        stopLossPrice: 495,
      });

      expect(res.calculatedShares).toBe(20);
      expect(res.totalCapitalRequired).toBe(10000);
      expect(res.isMarginRequired).toBe(true);
      expect(res.warningMessage).toBe("Exceeds Available Cash (Margin Required)");
      expect(res.portfolioAllocationPercent).toBe(200.0);
    });

    it("safely handles division by zero and invalid inputs", () => {
      // Entry equals Stop Loss
      const zeroRisk = calculatePositionSize({
        entryPrice: 100,
        stopLossPrice: 100,
      });
      expect(zeroRisk.dollarRiskPerShare).toBe(0);
      expect(zeroRisk.calculatedShares).toBe(0);
      expect(zeroRisk.t1Shares).toBe(0);
      expect(zeroRisk.t2Shares).toBe(0);
      expect(zeroRisk.totalCapitalRequired).toBe(0);

      // Missing or null inputs
      const nullInputs = calculatePositionSize({
        entryPrice: null,
        stopLossPrice: null,
      });
      expect(nullInputs.calculatedShares).toBe(0);
      expect(nullInputs.dollarRiskPerShare).toBe(0);

      // Negative prices
      const negInputs = calculatePositionSize({
        entryPrice: -50,
        stopLossPrice: 40,
      });
      expect(negInputs.calculatedShares).toBe(0);
    });
  });

  describe("2. Global Account Risk Settings (Persistent State)", () => {
    it("defines persistent storage keys and context properties in globalState", () => {
      expect(globalStateContent).toContain('STORAGE_KEY_ACCOUNT_EQUITY = "chizzle-account-equity"');
      expect(globalStateContent).toContain('STORAGE_KEY_DEFAULT_RISK_PCT = "chizzle-default-risk-pct"');
      expect(globalStateContent).toContain("accountEquity: number;");
      expect(globalStateContent).toContain("setAccountEquity: (equity: number) => void;");
      expect(globalStateContent).toContain("riskPercentage: number;");
      expect(globalStateContent).toContain("setRiskPercentage: (pct: number) => void;");
    });

    it("implements RiskSettingsBar component with input and segmented pill selector", () => {
      expect(riskBarContent).toContain('data-testid="button-risk-settings"');
      expect(riskBarContent).toContain('data-testid="input-account-equity"');
      expect(riskBarContent).toContain("data-testid={`risk-pill-${pct.toFixed(1)}`}");
      expect(riskBarContent).toContain("RISK_PERCENTAGE_OPTIONS = [0.5, 1.0, 1.5, 2.0]");
      expect(riskBarContent).toContain("ACCOUNT RISK SIZER");
    });

    it("mounts RiskSettingsBar in WealthEngineDashboard header", () => {
      expect(dashboardContent).toContain("<RiskSettingsBar />");
      expect(dashboardContent).toContain('data-testid="button-theme-switcher"');
    });
  });

  describe("3. Setup Card Summary Strip Integration", () => {
    it("renders dynamic position sizing in WealthEngineDashboard Studio Setup Card", () => {
      expect(dashboardContent).toContain('data-testid="studio-setup-summary-strip"');
      expect(dashboardContent).toContain('data-testid="studio-card-dollar-risk"');
      expect(dashboardContent).toContain('data-testid={`studio-card-risk-toggle-${pct}`}');
      expect(dashboardContent).toContain("Funding Allocated:");
      expect(dashboardContent).toContain("Position Size:");
      expect(dashboardContent).toContain("Target R-Multiple:");
      expect(dashboardContent).toContain("Scale Split:");
      expect(dashboardContent).toContain("Exceeds Available Cash (Margin Required)");
    });

    it("renders dynamic position sizing in Action Center TradingCard", () => {
      expect(tradingCardContent).toContain("data-testid={`setup-card-summary-strip-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`card-dollar-risk-${d.symbol}`}");
      expect(tradingCardContent).toContain("data-testid={`card-risk-toggle-${pct}-${d.symbol}`}");
      expect(tradingCardContent).toContain("Funding Allocated:");
      expect(tradingCardContent).toContain("Position Size:");
      expect(tradingCardContent).toContain("Target R-Multiple:");
      expect(tradingCardContent).toContain("Scale Split:");
      expect(tradingCardContent).toContain("Exceeds Available Cash (Margin Required)");
    });
  });

  describe("4. Fidelity Ticket Dynamic Binding", () => {
    it("dynamically injects calculated shares into FidelityExecutionGuide while preserving test contracts", () => {
      expect(fidelityGuideContent).toContain("usePositionSizer");
      expect(fidelityGuideContent).toContain("{calculatedShares} Shares");
      expect(fidelityGuideContent).toContain("{t1SharesCount} Shares");
      expect(fidelityGuideContent).toContain("{t2SharesCount} Shares");
      expect(fidelityGuideContent).toContain("100% of planned position");
      expect(fidelityGuideContent).toContain("50% of shares");
      expect(fidelityGuideContent).toContain("100% of shares");
      expect(fidelityGuideContent).toContain("Remaining 50% of shares");
      expect(fidelityGuideContent).toContain("data-testid=\"fidelity-guide-margin-warning\"");
    });
  });
});

