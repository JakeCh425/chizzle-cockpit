import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  evaluateQualityTradeValidation,
  UNMET_BADGES,
  UNMET_REASONS,
} from "../../client/src/hooks/useQualityTradeValidation";
import { calculatePositionSize } from "../../client/src/hooks/usePositionSizer";
import { marketDataStore, isBadTick } from "../../client/src/lib/useMarketDataStore";
import { isRegularMarketHours } from "../../server/marketHours";

describe("SUBJECT: Master Pipeline Consolidation - Flow Discrepancy Eradication, Quality Gates & Self-Funding Sizing Architecture", () => {
  const rootDir = path.resolve(__dirname, "../..");
  const tradingCardSrc = fs.readFileSync(path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"), "utf-8");
  const actionCenterSrc = fs.readFileSync(path.resolve(rootDir, "client/src/components/swing/ActionCenter.tsx"), "utf-8");
  const heroCardSrc = fs.readFileSync(path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx"), "utf-8");
  const fidelityGuideSrc = fs.readFileSync(path.resolve(rootDir, "client/src/components/FidelityExecutionGuide.tsx"), "utf-8");
  const pipelineHookSrc = fs.readFileSync(path.resolve(rootDir, "client/src/hooks/useMarketDataPipeline.ts"), "utf-8");
  const storeSrc = fs.readFileSync(path.resolve(rootDir, "client/src/lib/useMarketDataStore.ts"), "utf-8");
  const emailDispatcherSrc = fs.readFileSync(path.resolve(rootDir, "server/emailDispatcher.ts"), "utf-8");
  const telegramDispatcherSrc = fs.readFileSync(path.resolve(rootDir, "server/telegramDispatcher.ts"), "utf-8");

  // =========================================================================
  // 1. Unified Single-Connection Data Pipeline (Single Source of Truth)
  // =========================================================================
  describe("1. Unified Single-Connection Data Pipeline", () => {
    it("initializes quotes with null (never mock or historical fallback values)", () => {
      marketDataStore.clearData();
      const state = marketDataStore.getState();
      expect(state.currentPrice).toBeNull();
      expect(state.tickers).toEqual({});
    });

    it("verifies Bad-Tick Rejection Layer drops > 5.0% price jump during regular market hours", () => {
      // Prev price $100. Jump to $106 (+6%) -> Rejected
      expect(marketDataStore.isBadTick("AAPL", 106, 100)).toBe(true);
      // Drop to $94 (-6%) -> Rejected
      expect(marketDataStore.isBadTick("AAPL", 94, 100)).toBe(true);
      // Normal tick $103 (+3%) -> Accepted
      expect(marketDataStore.isBadTick("AAPL", 103, 100)).toBe(false);
      // First quote (prev is null) -> Accepted
      expect(marketDataStore.isBadTick("AAPL", 150, undefined)).toBe(false);
    });

    it("exposes clearData state wiping on selection or expansion", () => {
      marketDataStore.setCurrentPrice(250, "AAPL");
      expect(marketDataStore.getTickerPrice("AAPL")).toBe(250);

      marketDataStore.clearData("AAPL");
      expect(marketDataStore.getTickerPrice("AAPL")).toBeNull();
      expect(marketDataStore.getState().currentPrice).toBeNull();
    });

    it("mounts singleton useMarketDataPipeline at application root App.tsx", () => {
      const appSrc = fs.readFileSync(path.resolve(rootDir, "client/src/App.tsx"), "utf-8");
      expect(appSrc).toContain("useMarketDataPipeline");
      expect(appSrc).toContain("<MarketDataPipelineRoot />");
    });
  });

  // =========================================================================
  // 2. Execution-Quality Gatekeeper (No Low-Quality Trades)
  // =========================================================================
  describe("2. Execution-Quality Gatekeeper", () => {
    const validBaseSetup = {
      symbol: "NVDA",
      entryPrice: 130.00,
      stopLossPrice: 125.00, // risk = $5.00
      target1: 137.50,        // reward = $7.50 -> 1.5R
      target2: 140.00,        // 2.0R
      currentPrice: 130.10,
      sma20Price: 130.00,
      sma4h20: 128.00,
      sma4h50: 120.00,        // 4H 20 > 50 -> Bullish regime
      is1HCandleClosedGreen: true,
      supportHeld: true,
      structureLevels: [{ price: 145.00, kind: "RESISTANCE" }],
      availableCash: 10000,
      allocatedCapital: 2600, // 20 shares * 130
      shares: 20,
    };

    it("passes all 6 quality gates when setup meets strict criteria", () => {
      const res = evaluateQualityTradeValidation(validBaseSetup);
      expect(res.isValid).toBe(true);
      expect(res.unmetKey).toBeNull();
      expect(res.unmetReason).toBeNull();
      expect(res.unmetBadge).toBeNull();
      expect(res.validation.regimeValid).toBe(true);
      expect(res.validation.supportInteraction).toBe(true);
      expect(res.validation.confirmationBar).toBe(true);
      expect(res.validation.structuralResistanceOk).toBe(true);
      expect(res.validation.riskRewardRatio).toBeGreaterThanOrEqual(1.5);
      expect(res.validation.cashRequirementMet).toBe(true);
    });

    it("blocks setup when 4H trend regime is bearish (sma4h20 < sma4h50)", () => {
      const res = evaluateQualityTradeValidation({
        ...validBaseSetup,
        sma4h20: 118.00,
        sma4h50: 125.00,
      });
      expect(res.isValid).toBe(false);
      expect(res.unmetKey).toBe("regimeValid");
      expect(res.unmetBadge).toBe(UNMET_BADGES.regimeValid);
    });

    it("blocks setup when price has not touched/tested support within 0.5%", () => {
      const res = evaluateQualityTradeValidation({
        ...validBaseSetup,
        currentPrice: 135.00, // 3.8% above SMA20 (130)
        sma20Price: 130.00,
        supportHeld: false,
        testedLine: null,
        setupStatus: "SETUP_FORMING",
      });
      expect(res.isValid).toBe(false);
      expect(res.unmetKey).toBe("supportInteraction");
      expect(res.unmetBadge).toBe(UNMET_BADGES.supportInteraction);
    });

    it("blocks setup when 1H candle green confirmation is pending", () => {
      const res = evaluateQualityTradeValidation({
        ...validBaseSetup,
        is1HCandleClosedGreen: false,
        candleConfirmation: false,
        setupStatus: "AWAITING_CLOSE",
      });
      expect(res.isValid).toBe(false);
      expect(res.unmetKey).toBe("confirmationBar");
      expect(res.unmetBadge).toBe(UNMET_BADGES.confirmationBar);
    });

    it("blocks setup when overhead structural resistance sits before Target 1", () => {
      const res = evaluateQualityTradeValidation({
        ...validBaseSetup,
        target1: 138.00,
        structureLevels: [{ price: 134.00, kind: "RESISTANCE" }], // sits before T1 at 138
      });
      expect(res.isValid).toBe(false);
      expect(res.unmetKey).toBe("structuralResistanceOk");
      expect(res.unmetBadge).toBe(UNMET_BADGES.structuralResistanceOk);
    });

    it("blocks setup when Risk/Reward ratio is below 1.5R minimum threshold", () => {
      const res = evaluateQualityTradeValidation({
        ...validBaseSetup,
        entryPrice: 130.00,
        stopLossPrice: 125.00, // risk = $5.00
        target1: 134.00,        // reward = $4.00 -> 0.8R (< 1.5R)
      });
      expect(res.isValid).toBe(false);
      expect(res.unmetKey).toBe("riskRewardRatio");
      expect(res.unmetBadge).toBe(UNMET_BADGES.riskRewardRatio);
    });

    it("blocks setup when total capital required exceeds available cash balance", () => {
      const res = evaluateQualityTradeValidation({
        ...validBaseSetup,
        availableCash: 1000,
        allocatedCapital: 2600, // exceeds $1000 cash
      });
      expect(res.isValid).toBe(false);
      expect(res.unmetKey).toBe("cashRequirementMet");
      expect(res.unmetBadge).toBe(UNMET_BADGES.cashRequirementMet);
    });

    it("enforces UI locking on [ ARM TRADE ] and [ VIEW FIDELITY TICKET ] in TradingCard.tsx", () => {
      expect(tradingCardSrc).toContain("useQualityTradeValidation");
      expect(tradingCardSrc).toContain("badge-unmet-quality-");
      expect(tradingCardSrc).toContain("button-mini-guide-");
      expect(tradingCardSrc).toContain("button-arm-trade-");
      expect(tradingCardSrc).toContain("isQualityLocked");
      expect(tradingCardSrc).toContain("isArmDisabled");
    });

    it("gates ActionCenter isConfirmedSetup so unvalidated cards stay out of the Active Execution Zone", () => {
      expect(actionCenterSrc).toContain("evaluateQualityTradeValidation");
      expect(actionCenterSrc).toContain("if (!qualityVal.isValid)");
    });
  });

  // =========================================================================
  // 3. Notification Engine Overhaul (RTH Only & Session Deduplication)
  // =========================================================================
  describe("3. Notification Engine Overhaul", () => {
    it("enforces RTH gate between 9:30 AM and 4:00 PM EST (America/New_York)", () => {
      // Mon 10:00 AM EST (Regular Trading Hours)
      const rthDate = new Date("2026-11-09T15:00:00Z"); // 10:00 AM EST
      expect(isRegularMarketHours(rthDate)).toBe(true);

      // Mon 5:18 PM CT / 6:18 PM EST (After Hours)
      const afterHoursDate = new Date("2026-11-09T23:18:00Z"); // 6:18 PM EST
      expect(isRegularMarketHours(afterHoursDate)).toBe(false);

      // Saturday (Closed)
      const weekendDate = new Date("2026-11-07T16:00:00Z");
      expect(isRegularMarketHours(weekendDate)).toBe(false);
    });

    it("deprecates proximity emails in emailDispatcher.ts", () => {
      expect(emailDispatcherSrc).toContain('payload.status === "PROXIMITY_ALERT"');
      expect(emailDispatcherSrc).toContain('payload.status === "PRE_ENTRY"');
      expect(emailDispatcherSrc).toContain("isRegularMarketHours");
    });

    it("targets verified numeric TELEGRAM_TARGET_CHAT_ID", () => {
      expect(telegramDispatcherSrc).toContain("TELEGRAM_TARGET_CHAT_ID");
      expect(telegramDispatcherSrc).toContain("getVerifiedTelegramChatId");
      expect(telegramDispatcherSrc).toContain("isRegularMarketHours");
    });
  });

  // =========================================================================
  // 4. Fidelity Ticket & Position Sizing Alignment
  // =========================================================================
  describe("4. Fidelity Ticket & Position Sizing Alignment", () => {
    it("strictly calculates finalShares = min(riskBasedShares, cashBasedShares)", () => {
      // Account Equity $100,000, 1% risk budget = $1,000
      // Entry $100, Stop $95 -> $5 risk/share -> 200 risk shares
      // But Available Cash is only $10,000 -> 100 cash shares
      // finalShares = min(200, 100) = 100 shares
      const res = calculatePositionSize({
        accountEquity: 100000,
        riskPercentage: 1.0,
        availableCash: 10000,
        entryPrice: 100,
        stopLossPrice: 95,
      });

      expect(res.calculatedShares).toBe(100);
      expect(res.t1Shares).toBe(50); // Order 1: floor(100 / 2) = 50
      expect(res.t2Shares).toBe(50); // Order 3: 100 - 50 = 50
    });

    it("configures FidelityExecutionGuide with 3-order scale-out breakdown", () => {
      expect(fidelityGuideSrc).toContain("Math.floor(calculatedShares / 2)");
      expect(fidelityGuideSrc).toContain("order1Shares");
      expect(fidelityGuideSrc).toContain("order2Shares");
      expect(fidelityGuideSrc).toContain("order3RemainingShares");
    });
  });

  // =========================================================================
  // 5. Auto-Docking Execution Hero Card
  // =========================================================================
  describe("5. Auto-Docking Execution Hero Card", () => {
    it("renders Alert Sent timestamp audit badge in Hero Card", () => {
      expect(heroCardSrc).toContain("badge-hero-alert-sent");
      expect(heroCardSrc).toContain("Alert Sent:");
    });

    it("renders single-click 1-Click Copy Fidelity Ticket button in Hero Card", () => {
      expect(heroCardSrc).toContain("button-copy-fidelity-ticket-");
      expect(heroCardSrc).toContain("COPY FIDELITY ORDER TICKET");
      expect(heroCardSrc).toContain("ORDER TICKET COPIED TO CLIPBOARD");
    });
  });
});
