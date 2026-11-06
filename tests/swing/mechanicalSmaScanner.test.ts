process.env.DATABASE_URL ||= "postgres://x:y@127.0.0.1:1/none";
import { describe, it, expect } from "vitest";
import {
  calculateSMA,
  calculateATR,
  resample1HTo4H,
  evaluateMechanicalSMABars,
  getMechanicalScanResults,
  syncExternalScanResults,
  MECHANICAL_WATCHLIST,
  type BarData,
} from "../../server/mechanicalSmaScanner";

describe("Mechanical SMA Scanner Engine (4H Trend & 1H Execution)", () => {
  it("calculates SMA accurately", () => {
    const data = [10, 20, 30, 40, 50];
    expect(calculateSMA(data, 5)).toBe(30);
    expect(calculateSMA(data, 3)).toBe(40);
    expect(calculateSMA(data, 10)).toBe(0);
  });

  it("calculates ATR accurately for risk management", () => {
    const bars: BarData[] = Array.from({ length: 20 }, (_, i) => ({
      t: 1000 + i * 3600,
      o: 100 + i,
      h: 103 + i,
      l: 99 + i,
      c: 101 + i,
    }));
    const atr = calculateATR(bars, 14);
    expect(atr).toBeGreaterThan(0);
  });

  it("resamples 1H bars to 4H bars preserving high, low, open, close", () => {
    const bars1H: BarData[] = [
      { t: 0, o: 100, h: 105, l: 98, c: 102 },
      { t: 3600, o: 102, h: 106, l: 101, c: 104 },
      { t: 7200, o: 104, h: 107, l: 103, c: 105 },
      { t: 10800, o: 105, h: 108, l: 102, c: 107 },
    ];
    const bars4H = resample1HTo4H(bars1H);
    expect(bars4H).toHaveLength(1);
    expect(bars4H[0].o).toBe(100);
    expect(bars4H[0].h).toBe(108);
    expect(bars4H[0].l).toBe(98);
    expect(bars4H[0].c).toBe(107);
  });

  describe("Rule 1: Market Regime Filter (4-Hour Trend)", () => {
    it("hard-blocks all long setups with STANDBY_DAY when 4H 20 SMA <= 50 SMA (resistance ceilings)", () => {
      // Create downtrending bars where 4H 20 SMA < 50 SMA
      const bars1H: BarData[] = [];
      let price = 200;
      for (let i = 0; i < 250; i++) {
        price = price * 0.998;
        bars1H.push({
          t: i * 3600,
          o: price + 1,
          h: price + 2,
          l: price - 2,
          c: price,
        });
      }

      const result = evaluateMechanicalSMABars("SPY", bars1H);
      expect(result.status).toBe("STANDBY_DAY (Red Regime)");
      expect(result.actionable).toBe(false);
      expect(result.regime4H).toBe("Bearish");
      expect(result.is4hBullish).toBe(false);
      expect(result.subtext).toContain("resistance ceilings");
    });
  });

  describe("Rule 2: 1-Hour Execution Logic (10, 20, 50 SMAs)", () => {
    function generateBullish4HBars(lastBarOverride?: Partial<BarData>): BarData[] {
      const bars1H: BarData[] = [];
      let price = 100;
      // Strong uptrend over 250 bars so 4H 20 SMA > 50 SMA
      for (let i = 0; i < 249; i++) {
        price = price * 1.002;
        bars1H.push({
          t: i * 3600,
          o: price - 0.5,
          h: price + 1,
          l: price - 1,
          c: price,
        });
      }

      const baseLast = bars1H[bars1H.length - 1];
      bars1H.push({
        t: (bars1H.length) * 3600,
        o: lastBarOverride?.o ?? baseLast.c,
        h: lastBarOverride?.h ?? baseLast.c + 2,
        l: lastBarOverride?.l ?? baseLast.c - 0.5,
        c: lastBarOverride?.c ?? baseLast.c + 1,
      });

      return bars1H;
    }

    it("identifies WAIT FOR RETEST (Entry Missed) when price is floating above all 3 SMAs", () => {
      // In a strong uptrend with price extended high above SMAs
      const bars = generateBullish4HBars();
      const last = bars[bars.length - 1];
      // Make last bar float far above
      last.o = 180;
      last.h = 185;
      last.l = 179;
      last.c = 182;

      const result = evaluateMechanicalSMABars("NVDA", bars);
      expect(result.is4hBullish).toBe(true);
      expect(result.status).toBe("WAIT FOR RETEST (Entry Missed)");
      expect(result.actionable).toBe(false);
      expect(result.subtext).toContain("wait for retest");
    });

    it("identifies TESTING SMA (Wait for Close) when candle low touched SMA but has not reclaimed green", () => {
      const bars = generateBullish4HBars();
      // Calculate 1H 20 SMA
      const closes = bars.slice(0, -1).map((b) => b.c);
      const sma20 = calculateSMA(closes, 20);

      const last = bars[bars.length - 1];
      last.o = sma20 + 1;
      last.h = sma20 + 1.5;
      last.l = sma20 - 0.2; // touched 20 SMA
      last.c = sma20 - 0.1; // red candle closing below SMA

      const result = evaluateMechanicalSMABars("PLTR", bars);
      expect(result.is4hBullish).toBe(true);
      expect(result.status).toBe("TESTING SMA (Wait for Close)");
      expect(result.actionable).toBe(false);
      expect(result.subtext).toContain("Awaiting 1H green candle close");
    });

    it("triggers CONFIRMED BOUNCE and calculates 2:1 R:R when touched SMA and closed green", () => {
      const bars = generateBullish4HBars();
      const closes = bars.slice(0, -1).map((b) => b.c);
      const sma20 = calculateSMA(closes, 20);

      const last = bars[bars.length - 1];
      last.o = sma20 + 0.1;
      last.h = sma20 + 2.0;
      last.l = sma20 - 0.3; // touched 20 SMA
      last.c = sma20 + 1.5; // closed green above 20 SMA

      const result = evaluateMechanicalSMABars("AVGO", bars);
      expect(result.is4hBullish).toBe(true);
      expect(result.status).toBe("CONFIRMED BOUNCE");
      expect(result.actionable).toBe(true);
      expect(result.testedLine).toBe("20_SMA");

      // Verify dynamic 2:1 R:R math
      expect(result.entryPrice).toBe(last.c);
      expect(result.stopLoss).toBeLessThan(result.entryPrice!);
      expect(result.riskPerShare).toBeGreaterThan(0);
      expect(result.takeProfit2R).toBeCloseTo(result.entryPrice! + 2.0 * result.riskPerShare!, 2);
    });
  });

  describe("External Sync with Python Scanner Payload", () => {
    it("correctly syncs external payload from python scanner.py into in-memory store", () => {
      const pythonPayload = [
        {
          ticker: "MRVL",
          status: "CONFIRMED BOUNCE",
          actionable: true,
          price: 88.5,
          "4h_regime": "Bullish",
          tested_line: "20_SMA",
          entry_price: 88.5,
          stop_loss: 86.2,
          take_profit_2r: 93.1,
          risk_per_share: 2.3,
          "1h_sma10": 89.1,
          "1h_sma20": 87.5,
          "1h_sma50": 84.0,
          subtext: "Reclaimed 20 SMA green.",
        },
      ];

      const count = syncExternalScanResults(pythonPayload);
      expect(count).toBe(1);

      const results = getMechanicalScanResults(["MRVL"]);
      expect(results[0].ticker).toBe("MRVL");
      expect(results[0].status).toBe("CONFIRMED BOUNCE");
      expect(results[0].actionable).toBe(true);
      expect(results[0].price).toBe(88.5);
      expect(results[0].testedLine).toBe("20_SMA");
      expect(results[0].stopLoss).toBe(86.2);
      expect(results[0].takeProfit2R).toBe(93.1);
    });
  });
});
