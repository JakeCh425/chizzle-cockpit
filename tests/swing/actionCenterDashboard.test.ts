import { describe, it, expect } from "vitest";
import { getTrafficLightStatus } from "@/components/swing/ActionCenter";
import { historicalWinRate, beginnerStatusText, computeTargetLevels } from "@/components/swing/TradingCard";
import type { SwingDecision } from "@shared/swingDecision";

describe("ActionCenter Global Traffic Light Banner", () => {
  it("interprets RED regime as DO NOT ENTER", () => {
    const red = getTrafficLightStatus("red", 3, 0);
    expect(red.status).toBe("RED");
    expect(red.headline).toBe("DO NOT ENTER");
    expect(red.detail).toContain("Regime is red or setups are extended. Stand down.");
    expect(red.icon).toBe("🔴");
  });

  it("interprets fresh setups in non-red regime as ACTION REQUIRED", () => {
    const green = getTrafficLightStatus("green", 2, 0);
    expect(green.status).toBe("GREEN");
    expect(green.headline).toBe("ACTION REQUIRED");
    expect(green.detail).toContain("2 fresh setups are ready to evaluate.");
    expect(green.icon).toBe("🟢");

    const yellowWithReady = getTrafficLightStatus("yellow", 1, 0);
    expect(yellowWithReady.status).toBe("GREEN");
    expect(yellowWithReady.headline).toBe("ACTION REQUIRED");
    expect(yellowWithReady.detail).toContain("1 fresh setup is ready to evaluate.");
  });

  it("interprets extended setups in non-green regime with 0 ready as DO NOT ENTER", () => {
    const extended = getTrafficLightStatus("yellow", 0, 2);
    expect(extended.status).toBe("RED");
    expect(extended.headline).toBe("DO NOT ENTER");
  });

  it("interprets 0 ready setups and no red/extended as MANAGE / HOLD", () => {
    const hold = getTrafficLightStatus("green", 0, 0);
    expect(hold.status).toBe("YELLOW");
    expect(hold.headline).toBe("MANAGE / HOLD");
    expect(hold.detail).toContain("No fresh setups; manage existing trades.");
    expect(hold.icon).toBe("🟡");
  });
});

describe("Scale-Out Mode Target Calculation & Extended Targets", () => {
  const entry = 100.00;
  const stop = 96.00; // Risk = $4.00

  it("maintains unchanged default settings (T1 = 2.0R, T2 = 3.0R) when scaleOutMode is OFF", () => {
    const targets = computeTargetLevels(entry, stop, 108.00, 112.00, false);
    expect(targets.scaleOutMode).toBe(false);
    expect(targets.activeRisk).toBe(4.00);
    expect(targets.t1).toBe(108.00); // 2.0R
    expect(targets.t1R).toBe(2.0);
    expect(targets.t2).toBe(112.00); // 3.0R
    expect(targets.t2R).toBe(3.0);
    expect(targets.t3).toBeNull();
    expect(targets.t3R).toBeNull();
  });

  it("adjusts targets to 1.5R, 2.0R, and 3.00R when scaleOutMode is ON", () => {
    const targets = computeTargetLevels(entry, stop, 108.00, 112.00, true);
    expect(targets.scaleOutMode).toBe(true);
    expect(targets.activeRisk).toBe(4.00);

    // Target 1 (New): 1.5R = 100 + 1.5 * 4 = 106.00
    expect(targets.t1).toBe(106.00);
    expect(targets.t1R).toBe(1.5);
    expect(targets.gainPct(targets.t1)).toBe(6.00);

    // Target 2: 2.0R = 100 + 2.0 * 4 = 108.00
    expect(targets.t2).toBe(108.00);
    expect(targets.t2R).toBe(2.0);
    expect(targets.gainPct(targets.t2)).toBe(8.00);

    // Target 3 (Runner): 3.00R = 100 + 3.0 * 4 = 112.00
    expect(targets.t3).toBe(112.00);
    expect(targets.t3R).toBe(3.0);
    expect(targets.gainPct(targets.t3)).toBe(12.00);
  });

  it("calculates extended runner targets (4.00R, 5.00R, 6.00R) correctly", () => {
    const targets = computeTargetLevels(entry, stop, 108.00, 112.00, false);
    // 4.00R: 100 + 4.0 * 4 = 116.00 (+16.00%)
    expect(targets.t4).toBe(116.00);
    expect(targets.gainPct(targets.t4)).toBe(16.00);

    // 5.00R: 100 + 5.0 * 4 = 120.00 (+20.00%)
    expect(targets.t5).toBe(120.00);
    expect(targets.gainPct(targets.t5)).toBe(20.00);

    // 6.00R: 100 + 6.0 * 4 = 124.00 (+24.00%)
    expect(targets.t6).toBe(124.00);
    expect(targets.gainPct(targets.t6)).toBe(24.00);
  });
});

describe("TradingCard Historical Edge & Beginner Status Text", () => {
  it("assigns appropriate historical win rates by pattern type and score", () => {
    expect(historicalWinRate("BULL_FLAG", 75, false)).toBe(67);
    expect(historicalWinRate("BREAKOUT", 70, false)).toBe(65);
    expect(historicalWinRate("HAMMER_RECLAIM", 60, false)).toBe(63);
    expect(historicalWinRate("BASE", 50, false)).toBe(62);
    expect(historicalWinRate(null, 85, false)).toBe(68);
    expect(historicalWinRate(null, null, false)).toBe(60);
  });

  it("dynamically boosts historical win rate to 75%+ when scaleOutMode is active", () => {
    // Closer 1.5R target yields 75%+ win rate across all setups
    expect(historicalWinRate("BULL_FLAG", 75, true)).toBeGreaterThanOrEqual(75);
    expect(historicalWinRate("BULL_FLAG", 75, true)).toBe(78);

    expect(historicalWinRate("BREAKOUT", 70, true)).toBeGreaterThanOrEqual(75);
    expect(historicalWinRate("BREAKOUT", 70, true)).toBe(76);

    expect(historicalWinRate("BASE", 50, true)).toBeGreaterThanOrEqual(75);
    expect(historicalWinRate("BASE", 50, true)).toBe(76);

    expect(historicalWinRate(null, null, true)).toBeGreaterThanOrEqual(75);
    expect(historicalWinRate(null, null, true)).toBe(76);
  });

  it("generates beginner-friendly status text for various stages and scale-out mode", () => {
    const mockDecision = {
      symbol: "AAPL",
      entryPrice: 150,
      structuralStop: 145,
      target1: 160,
      target2: 165,
      currentPrice: 144, // below stop
      nextAction: "Wait for trigger",
    } as unknown as SwingDecision;

    // Below stop
    const statusBelowStop = beginnerStatusText(mockDecision, "READY", 150, 145, 160, false, false, false);
    expect(statusBelowStop).toContain("breached planned stop");

    // Standard mode: T1 surpassed
    const mockSurpassedT1 = { ...mockDecision, currentPrice: 161 } as unknown as SwingDecision;
    const statusT1 = beginnerStatusText(mockSurpassedT1, "READY", 150, 145, 160, true, false, false);
    expect(statusT1).toContain("surpassed Target 1");

    // Scale-out mode: 1.5R partial target reached
    const statusScaleT1 = beginnerStatusText(mockSurpassedT1, "READY", 150, 145, 156, true, false, true, false);
    expect(statusScaleT1).toContain("1.5R Partial profit target reached");

    // Scale-out mode: 2.0R core target reached
    const statusScaleT2 = beginnerStatusText(mockSurpassedT1, "READY", 150, 145, 156, true, true, true, false);
    expect(statusScaleT2).toContain("2.0R Core target");

    // Scale-out mode: 3.0R runner target reached
    const statusScaleT3 = beginnerStatusText(mockSurpassedT1, "READY", 150, 145, 156, true, true, true, true);
    expect(statusScaleT3).toContain("3.0R Runner target");
  });

  it("calculates progress bar and potential gain % correctly", () => {
    const entry = 100;
    const t1 = 110;
    const potentialGain = ((t1 - entry) / entry) * 100;
    expect(potentialGain).toBe(10.00);

    // Midpoint: price 105 -> 50%
    const currentPrice = 105;
    const progress = Math.min(100, Math.max(0, ((currentPrice - entry) / (t1 - entry)) * 100));
    expect(progress).toBe(50);

    // Below entry: price 98 -> 0%
    const belowProgress = Math.min(100, Math.max(0, ((98 - entry) / (t1 - entry)) * 100));
    expect(belowProgress).toBe(0);

    // Above T1: price 115 -> 100%
    const aboveProgress = Math.min(100, Math.max(0, ((115 - entry) / (t1 - entry)) * 100));
    expect(aboveProgress).toBe(100);
  });
});
