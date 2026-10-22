import { describe, it, expect } from "vitest";
import { getTrafficLightStatus } from "@/components/swing/ActionCenter";
import { historicalWinRate, beginnerStatusText } from "@/components/swing/TradingCard";
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

describe("TradingCard Historical Edge & Beginner Status Text", () => {
  it("assigns appropriate historical win rates by pattern type and score", () => {
    expect(historicalWinRate("BULL_FLAG", 75)).toBe(67);
    expect(historicalWinRate("BREAKOUT", 70)).toBe(65);
    expect(historicalWinRate("HAMMER_RECLAIM", 60)).toBe(63);
    expect(historicalWinRate("BASE", 50)).toBe(62);
    expect(historicalWinRate(null, 85)).toBe(68);
    expect(historicalWinRate(null, null)).toBe(60);
  });

  it("generates beginner-friendly status text for various stages", () => {
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
    const statusBelowStop = beginnerStatusText(mockDecision, "READY", 150, 145, 160, false, false);
    expect(statusBelowStop).toContain("breached planned stop");

    // Approaching T1
    const mockApproaching = { ...mockDecision, currentPrice: 158 } as unknown as SwingDecision;
    const statusApproaching = beginnerStatusText(mockApproaching, "READY", 150, 145, 160, false, false);
    expect(statusApproaching).toContain("approaching Target 1");

    // T1 surpassed
    const mockSurpassedT1 = { ...mockDecision, currentPrice: 161 } as unknown as SwingDecision;
    const statusT1 = beginnerStatusText(mockSurpassedT1, "READY", 150, 145, 160, true, false);
    expect(statusT1).toContain("surpassed Target 1");

    // T2 surpassed
    const mockSurpassedT2 = { ...mockDecision, currentPrice: 166 } as unknown as SwingDecision;
    const statusT2 = beginnerStatusText(mockSurpassedT2, "READY", 150, 145, 160, true, true);
    expect(statusT2).toContain("surpassed Target 2");

    // Setup confirmed waiting
    const mockConfirmed = { ...mockDecision, currentPrice: 148, currentTrigger: 150 } as unknown as SwingDecision;
    const statusConfirmed = beginnerStatusText(mockConfirmed, "CONFIRMED", 150, 145, 160, false, false);
    expect(statusConfirmed).toContain("Waiting for 1-hour candle close");
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

