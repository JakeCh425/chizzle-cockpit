import { describe, it, expect } from "vitest";
import { parseNum, r2, sizePosition } from "@shared/positionSizing";

describe("Card Overrides & Recalculation", () => {
  const enginePlan = {
    entry: 68.04,
    stop: 66.75,
    t1: 70.62,
    t2: 71.91,
    equity: 50000,
    cash: 25000,
    riskPct: 1, // 1% = $500 risk budget
  };

  it("calculates Risk/sh and sizing using entry and stop overrides", () => {
    const entryOverride = "70.00";
    const stopOverride = "67.50";

    const parsedE = parseNum(entryOverride)!;
    const parsedS = parseNum(stopOverride)!;
    const riskPerShare = r2(Math.abs(parsedE - parsedS));

    expect(riskPerShare).toBe(2.50);

    const sizing = sizePosition({
      equity: enginePlan.equity,
      riskPct: enginePlan.riskPct,
      riskPctLimit: 2,
      cash: enginePlan.cash,
      allocation: 25000,
      entry: parsedE,
      stop: parsedS,
    });

    expect(sizing.ok).toBe(true);
    expect(sizing.riskPerShare).toBe(2.50);
    // Budget $500 / $2.50 = 200 shares
    expect(sizing.shares).toBe(200);
    // Cost: 200 * 70.00 = 14,000 <= 25,000 cash
    expect(sizing.positionCost).toBe(14000);
    // Planned loss: 200 * 2.50 = $500
    expect(sizing.plannedLoss).toBe(500);
    expect(sizing.riskPctOfEquity).toBe(1);

    // Calculated R targets (2R, 3R)
    const t1 = r2(parsedE + 2 * riskPerShare);
    const t2 = r2(parsedE + 3 * riskPerShare);
    expect(t1).toBe(75.00);
    expect(t2).toBe(77.50);
  });

  it("partially overrides entry while keeping engine stop", () => {
    const entryOverride = "69.00";
    const parsedE = parseNum(entryOverride)!;
    const S = enginePlan.stop;
    const riskPerShare = r2(Math.abs(parsedE - S));

    expect(riskPerShare).toBe(2.25); // 69.00 - 66.75

    const sizing = sizePosition({
      equity: enginePlan.equity,
      riskPct: enginePlan.riskPct,
      riskPctLimit: 2,
      cash: enginePlan.cash,
      allocation: 25000,
      entry: parsedE,
      stop: S,
    });

    expect(sizing.ok).toBe(true);
    expect(sizing.shares).toBe(222); // floor(500 / 2.25) = 222
    expect(sizing.positionCost).toBe(r2(222 * 69.00));
    expect(sizing.plannedLoss).toBe(r2(222 * 2.25));
  });

  it("resets overrides back to original engine plan levels", () => {
    let entryOv: string | null = "72.00";
    let stopOv: string | null = "68.00";

    // Simulate reset action (clears override state to null)
    entryOv = null;
    stopOv = null;

    const activeEntry = entryOv != null ? parseNum(entryOv) : enginePlan.entry;
    const activeStop = stopOv != null ? parseNum(stopOv) : enginePlan.stop;

    expect(activeEntry).toBe(68.04);
    expect(activeStop).toBe(66.75);

    const originalRisk = r2(Math.abs(activeEntry! - activeStop!));
    expect(originalRisk).toBe(1.29);

    const sizing = sizePosition({
      equity: enginePlan.equity,
      riskPct: enginePlan.riskPct,
      riskPctLimit: 2,
      cash: enginePlan.cash,
      allocation: 25000,
      entry: activeEntry,
      stop: activeStop,
    });

    expect(sizing.ok).toBe(true);
    expect(sizing.shares).toBe(367); // min(cash: floor(25000/68.04)=367, risk: floor(500/1.29)=387)
    expect(sizing.positionCost).toBe(r2(367 * 68.04));
  });
});
