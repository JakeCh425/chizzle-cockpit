import { describe, it, expect } from "vitest";
import { DEFAULT_WATCHLIST } from "@/lib/wealthWatchlist";
import { is10EmaMomentumSetup, rollingEMA } from "@/lib/sma";
import fs from "fs";
import path from "path";

const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
const tradingCardPath = path.resolve(__dirname, "../../client/src/components/swing/TradingCard.tsx");
const actionCenterPath = path.resolve(__dirname, "../../client/src/components/swing/ActionCenter.tsx");
const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");

describe("Wealth Studio Execution Integration & Cockpit Scanner Expansion", () => {
  const dashSrc = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");
  const tradingCardSrc = fs.readFileSync(tradingCardPath, "utf-8").replace(/\r\n/g, "\n");
  const actionCenterSrc = fs.readFileSync(actionCenterPath, "utf-8").replace(/\r\n/g, "\n");
  const globalStateSrc = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Expand the Cockpit Scanner (10-EMA & Diversification)", () => {
    it("detects 10-EMA momentum setups on runaway trends holding 10-EMA", () => {
      const closes = [
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
        110, 111, 112, 113, 114, 115, 116, 117, 118, 120
      ];
      const ema = rollingEMA(closes, 10);
      const emaAt19 = ema[19]!;
      const lows = closes.map((c) => c - 1);
      lows[19] = emaAt19; // touches 10-EMA
      const opens = closes.map((c) => c - 0.5);
      opens[19] = emaAt19 + 1; // close (120) >= open (emaAt19 + 1) -> green

      const isSetup = is10EmaMomentumSetup(closes, undefined, lows, opens);
      expect(isSetup).toBe(true);
    });

    it("tags setup cards with [ MOMENTUM SETUP: 10-EMA ] badge", () => {
      expect(tradingCardSrc).toContain('data-testid="badge-momentum-10ema"');
      expect(tradingCardSrc).toContain("[ MOMENTUM SETUP: 10-EMA ]");
      expect(dashSrc).toContain('data-testid="badge-momentum-10ema"');
      expect(dashSrc).toContain("[ MOMENTUM SETUP: 10-EMA ]");
    });

    it("injects uncorrelated sector leaders (XLF, XLI, JPM, CAT, COST) into default universe", () => {
      const symbols = DEFAULT_WATCHLIST.map((item) => item.symbol);
      for (const req of ["XLF", "XLI", "JPM", "CAT", "COST"]) {
        expect(symbols).toContain(req);
      }
    });
  });

  describe("2. Integrate Trade Cards into Wealth Studio", () => {
    it("imports SetupCard from TradingCard in WealthEngineDashboard", () => {
      expect(dashSrc).toContain('import { SetupCard } from "@/components/swing/TradingCard";');
      expect(tradingCardSrc).toContain("export const SetupCard = InlineTradingCard;");
    });

    it("dynamically binds card setup data to activeTicker from main chart", () => {
      expect(dashSrc).toContain("const activeTicker = activeTickerData?.symbol ?? global?.activeTicker ?? \"NVDA\";");
      expect(dashSrc).toContain("{activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker}");
      expect(dashSrc).toContain("${(item.symbol === activeTickerData?.symbol ? activeTickerData.price : (item.price ?? 100)).toFixed(2)}");
    });
  });

  describe("3. Predictive AI & Direct Execution (Arming the Trade)", () => {
    it("calculates price distance to SMA support and displays predictive proximity states", () => {
      expect(dashSrc).toContain("proximityPct = Math.abs(currentPrice - sma20Price) / currentPrice * 100");
      expect(dashSrc).toContain('data-testid="badge-predictive-readiness"');
      expect(dashSrc).toContain("[ READY TO TRIGGER (90%+) ]");
      expect(dashSrc).toContain("[ FORMING PULLBACK (~60%) ]");
    });

    it("auto-populates trade levels (Limit Buy, Stop Loss, Target 1 at 1.5R)", () => {
      expect(dashSrc).toContain("const entryPriceVal = isBuyAligned ? baseActiveItem.buyTarget! : currentPrice;");
      expect(dashSrc).toContain("const t1Val = +(entryPriceVal + riskVal * 1.5).toFixed(2);");
      expect(dashSrc).toContain("data-testid=\"trade-level-buy\"");
      expect(dashSrc).toContain("data-testid=\"trade-level-stop\"");
      expect(dashSrc).toContain("data-testid=\"trade-level-t1\"");
    });

    it("wires [ ARM TRADE ] on Wealth Studio card to global execution state and Action Center Confirmed row", () => {
      expect(dashSrc).toContain('data-testid="button-arm-practice-trade"');
      expect(dashSrc).toContain("global.setConfirmedSetup?.(sym, true);");
      expect(dashSrc).toContain("void tradeApi.arm({");
      expect(dashSrc).toContain("Direct Execution from Wealth Studio:");
      expect(dashSrc).toContain("openArmTrade(activeTickerData?.symbol ?? activeItem?.symbol ?? activeTicker);");
      expect(actionCenterSrc).toContain("confirmedSymSet.has(d.symbol)");
    });
  });
});
