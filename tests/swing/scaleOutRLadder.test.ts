import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { calculateScaleOutLadder } from "../../client/src/components/swing/ScaleOutRLadder";

const rootDir = path.resolve(__dirname, "../..");

describe("Setup Card Refactor - Embedded Scale-Out R-Ladder (1.5R Partial + 2R/3R/4R Runners)", () => {
  describe("1. Scale-Out Mathematical Logic", () => {
    it("splits shares evenly: half off at T1 (1.5R), remainder to runners (2R, 3R, 4R)", () => {
      // 10 total shares, entry 100, stop 95 (risk $5/share)
      const ladder = calculateScaleOutLadder(100, 95, 10);

      expect(ladder.t1Shares).toBe(5);
      expect(ladder.runnerShares).toBe(5);
      expect(ladder.riskPerShare).toBe(5);

      // Target Price Levels
      expect(ladder.price1_5R).toBe(107.5);
      expect(ladder.price2_0R).toBe(110.0);
      expect(ladder.price3_0R).toBe(115.0);
      expect(ladder.price4_0R).toBe(120.0);

      // Dollar return calculations
      // 1.5R exits 5 shares: 7.50 * 5 = 37.50 -> Math.round 38
      expect(ladder.profit1_5R).toBe(38);
      // 2.0R: 37.50 banked + 10.00 * 5 = 87.50 -> Math.round 88
      expect(ladder.profit2_0R).toBe(88);
      // 3.0R: 37.50 banked + 15.00 * 5 = 112.50 -> Math.round 113
      expect(ladder.profit3_0R).toBe(113);
      // 4.0R: 37.50 banked + 20.00 * 5 = 137.50 -> Math.round 138
      expect(ladder.profit4_0R).toBe(138);

      // Percentage gain calculations
      expect(ladder.gainPct1_5R).toBe(7.5);
      expect(ladder.gainPct2_0R).toBe(10.0);
      expect(ladder.gainPct3_0R).toBe(15.0);
      expect(ladder.gainPct4_0R).toBe(20.0);
    });

    it("handles institutional size properly (e.g., 74 shares for JPM / AAPL)", () => {
      // 74 shares, entry 200, stop 196 (risk $4/sh)
      const ladder = calculateScaleOutLadder(200, 196, 74);

      expect(ladder.t1Shares).toBe(37);
      expect(ladder.runnerShares).toBe(37);
      expect(ladder.riskPerShare).toBe(4);

      expect(ladder.price1_5R).toBe(206.0);
      expect(ladder.price2_0R).toBe(208.0);
      expect(ladder.price3_0R).toBe(212.0);
      expect(ladder.price4_0R).toBe(216.0);

      // 1.5R: 6 * 37 = 222
      expect(ladder.profit1_5R).toBe(222);
      // 2.0R: 222 + (8 * 37) = 222 + 296 = 518
      expect(ladder.profit2_0R).toBe(518);
      // 3.0R: 222 + (12 * 37) = 222 + 444 = 666
      expect(ladder.profit3_0R).toBe(666);
      // 4.0R: 222 + (16 * 37) = 222 + 592 = 814
      expect(ladder.profit4_0R).toBe(814);
    });
  });

  describe("2. UI Layout & Styling Specs in ScaleOutRLadder Component", () => {
    it("verifies container classes match required design specifications", () => {
      const src = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ScaleOutRLadder.tsx"),
        "utf-8"
      );

      // Container: grid grid-cols-4 gap-1.5 p-2 bg-gray-950/70 border border-gray-800 rounded-md my-2
      expect(src).toContain("grid grid-cols-4 gap-1.5 p-2 bg-gray-950/70 border border-gray-800 rounded-md my-2");
      // Labels: text-[10px] font-mono uppercase tracking-wider text-gray-400
      expect(src).toContain("text-[10px] font-mono uppercase tracking-wider text-gray-400");
      // Prices: font-mono text-xs font-bold text-white
      expect(src).toContain("font-mono text-xs font-bold text-white");
      // Returns & Profit: font-mono text-[11px] text-emerald-400 font-semibold
      expect(src).toContain("font-mono text-[11px] text-emerald-400 font-semibold");
    });

    it("includes required column labels and subtitle badges", () => {
      const src = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ScaleOutRLadder.tsx"),
        "utf-8"
      );

      // Column titles
      expect(src).toContain("1.5R (T1 Scale)");
      expect(src).toContain("2.0R (Core T2)");
      expect(src).toContain("3.0R (Runner)");
      expect(src).toContain("4.0R (Extended)");

      // Actionable pills
      expect(src).toContain("[Sell 50%]");
      expect(src).toContain("[Remaining]");
      expect(src).toContain("[Runner]");
      expect(src).toContain("[Moonshot]");

      // Share counters
      expect(src).toContain("Sell ${ladder.t1Shares} sh");
      expect(src).toContain("Running ${ladder.runnerShares} sh");
    });

    it("verifies dynamic resistance warning badge rendering '⚠️ Res $XXX.XX'", () => {
      const src = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ScaleOutRLadder.tsx"),
        "utf-8"
      );

      // Resistance tag format
      expect(src).toContain("⚠️ Res ${resistancePrice.toFixed(2)}");
      expect(src).toContain("text-amber-300");
      expect(src).toContain("border-amber-500/40");
      expect(src).toContain("bg-amber-500/15");
    });
  });

  describe("3. Card Integration (ActiveExecutionHeroCard & TradingCard)", () => {
    it("embeds ScaleOutRLadder inside ActiveExecutionHeroCard beneath Entry/Stop numbers", () => {
      const heroCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/ActiveExecutionHeroCard.tsx"),
        "utf-8"
      );

      expect(heroCardSrc).toContain("ScaleOutRLadder");
      expect(heroCardSrc).toContain("entryPrice={trade.entryPrice}");
      expect(heroCardSrc).toContain("stopLossPrice={trade.stopLoss}");
      expect(heroCardSrc).toContain("totalShares={trade.shares}");
    });

    it("embeds ScaleOutRLadder inside TradingCard beneath Entry/Stop core metrics", () => {
      const tradingCardSrc = fs.readFileSync(
        path.resolve(rootDir, "client/src/components/swing/TradingCard.tsx"),
        "utf-8"
      );

      expect(tradingCardSrc).toContain("ScaleOutRLadder");
      expect(tradingCardSrc).toContain("entryPrice={activeEntry}");
      expect(tradingCardSrc).toContain("stopLossPrice={activeStop}");
    });
  });
});
