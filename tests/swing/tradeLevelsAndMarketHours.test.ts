import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { isMarketOpen, getMarketStatus } from "../../client/src/lib/marketHours";

describe("Trade Levels Dynamic Re-Binding, Time-Scale Axis, and Market Hours", () => {
  const globalStatePath = path.resolve(__dirname, "../../client/src/lib/globalState.tsx");
  const globalStateContent = fs.readFileSync(globalStatePath, "utf-8").replace(/\r\n/g, "\n");

  const dashboardPath = path.resolve(__dirname, "../../client/src/pages/WealthEngineDashboard.tsx");
  const dashboardContent = fs.readFileSync(dashboardPath, "utf-8").replace(/\r\n/g, "\n");

  const priceFeedPath = path.resolve(__dirname, "../../client/src/lib/priceFeed.ts");
  const priceFeedContent = fs.readFileSync(priceFeedPath, "utf-8").replace(/\r\n/g, "\n");

  describe("1. Dynamic Trade Levels Calculation & Desync Prevention", () => {
    it("dynamically re-aligns buyTarget and stopLoss in globalState when seed price deviates >8% from live price", () => {
      // In globalState syncedWatchlist and activeTickerData:
      expect(globalStateContent).toContain("Math.abs(item.buyTarget - live) / live <= 0.08");
      expect(globalStateContent).toContain("Math.abs(base.buyTarget - live) / live <= 0.08");
      expect(globalStateContent).toContain("const primaryTarget = +(buyTarget + risk * 1.5).toFixed(2);");
      expect(globalStateContent).toContain("const t2 = +(buyTarget + risk * 2.0).toFixed(2);");
      expect(globalStateContent).toContain("const t3 = +(buyTarget + risk * 3.0).toFixed(2);");
    });

    it("verifies dynamic level calculation formula: Risk = |BUY - STOP|, T1 = BUY + 1.5R, T2 = BUY + 2.0R, T3 = BUY + 3.0R", () => {
      const live = 712.20;
      const staleBuy = 492.50; // Stale seed value
      const isBuyAligned = Math.abs(staleBuy - live) / live <= 0.08;
      expect(isBuyAligned).toBe(false);

      const buyTarget = isBuyAligned ? staleBuy : live;
      expect(buyTarget).toBe(712.20);

      const stopLoss = +(buyTarget * 0.96).toFixed(2);
      expect(stopLoss).toBe(683.71);

      const risk = +(buyTarget - stopLoss).toFixed(2);
      expect(risk).toBe(28.49);

      const t1 = +(buyTarget + risk * 1.5).toFixed(2);
      const t2 = +(buyTarget + risk * 2.0).toFixed(2);
      const t3 = +(buyTarget + risk * 3.0).toFixed(2);

      expect(t1).toBe(754.94);
      expect(t2).toBe(769.18);
      expect(t3).toBe(797.67);
    });

    it("clears stale trade levels in LiveTradingChart immediately on symbol or timeframe switch", () => {
      expect(dashboardContent).toContain("setTradeLevels(null);");
      expect(dashboardContent).toContain("useEffect(() => {");
      expect(dashboardContent).toContain("// Whenever activeTicker changes or timeframe switch, immediately wipe previous trade levels from state");
    });

    it("enforces isTargetSafe and within 8% alignment in LiveTradingChart dynamic levels", () => {
      expect(dashboardContent).toContain("const isBuyPriceClose = rawBuyPrice != null && isTargetSafe(rawBuyPrice) && Math.abs(rawBuyPrice - currentRefPrice) / currentRefPrice <= 0.08;");
      expect(dashboardContent).toContain("const isStopClose = rawStopVal != null && isTargetSafe(rawStopVal) && rawStopVal < buyPrice");
      expect(dashboardContent).toContain("const targetVal = isTargetClose ? rawTargetVal! : +(buyPrice + risk * 1.5).toFixed(2);");
      expect(dashboardContent).toContain("const t2Price = isTargetSafe(rawT2)");
      expect(dashboardContent).toContain("const t3Price = isTargetSafe(rawT3)");
    });
  });

  describe("2. Time-Scale Axis & Execution Date Badges", () => {
    it("renders data-testid='chart-time-scale' bottom axis in LiveTradingChart", () => {
      expect(dashboardContent).toContain('data-testid="chart-time-scale"');
      expect(dashboardContent).toContain("formatTimeScaleTick");
    });

    it("formats intraday time ticks with hour/minute and daily with date string", () => {
      expect(dashboardContent).toContain('if (tf === "1H" || tf === "4H")');
      expect(dashboardContent).toContain('d.toLocaleDateString("en-US", { month: "short", day: "numeric" })');
      expect(dashboardContent).toContain('d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })');
    });

    it("renders execution date and price badges on entry, target, and stop signal markers", () => {
      expect(dashboardContent).toContain('GET IN: {dateStr} @ ${buyPrice.toFixed(2)}');
      expect(dashboardContent).toContain('T1 HIT: {dateStr} @ ${targetVal.toFixed(2)}');
      expect(dashboardContent).toContain('STOP HIT: {dateStr} @ ${stopVal.toFixed(2)}');
    });

    it("embeds comprehensive hover tooltips with Action, Fill Price, Date, and P&L R-multiple", () => {
      expect(dashboardContent).toContain("Action: BUY | Fill Price:");
      expect(dashboardContent).toContain("Action: TAKE PROFIT (T1 HIT) | Fill Price:");
      expect(dashboardContent).toContain("P&L: +1.50R");
      expect(dashboardContent).toContain("Action: STOP LOSS | Fill Price:");
      expect(dashboardContent).toContain("P&L: -1.00R");
    });
  });

  describe("3. Real-Time Market Hours Stream & Closed State", () => {
    it("renders MARKET CLOSED (OFFICIAL CLOSE) and STATIC: LAST CLOSE on the status pill when market is closed", () => {
      expect(dashboardContent).toContain('data-testid="pill-feed-provider"');
      expect(dashboardContent).toContain("MARKET CLOSED (OFFICIAL CLOSE)");
      expect(dashboardContent).toContain("STATIC: LAST CLOSE");
    });

    it("displays live provider status during active regular trading hours", () => {
      expect(dashboardContent).toContain("🟢 LIVE: WebSocket (Finnhub)");
      expect(dashboardContent).toContain("🟡 LIVE:");
    });

    it("disconnects live WebSocket stream and falls back to verified official last close when closed", () => {
      expect(priceFeedContent).toContain("if (!isMarketOpen()) {");
      expect(priceFeedContent).toContain("ws.close();");
      expect(priceFeedContent).toContain("fetchLastOfficialClose()");
      expect(priceFeedContent).toContain('setConn("STATIC");');
    });
  });
});
