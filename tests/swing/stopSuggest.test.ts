import { describe, it, expect } from "vitest";
import { suggestStops } from "@shared/practicePlan";

const ctx = { original: { entry: 754.48, stop: 747.46, stopLimit: 745.97, t1: 768.52, t2: 775.54, riskPerShare: 7.02, rrT1: 2, rrT2: 3 }, atr1h: 2.4 };
const lows1h = [{ price: 751.77, time: "2026-10-07T13:30:00.000Z" }, { price: 747.78, time: "2026-10-02T15:30:00.000Z" }];
const lows4h = [{ price: 747.78, time: "2026-10-02T13:30:00.000Z" }, { price: 736.25, time: "2026-09-29T13:30:00.000Z" }];

describe("quick-card stop suggestions", () => {
  it("offers the structural stop plus the nearest 1H and 4H lows below the entry, each with a buffer", () => {
    const s = suggestStops(ctx, lows1h, lows4h, 755, 16.25);
    expect(s.map((x) => x.id)).toEqual(["STRUCTURAL", "SWING_1H", "SWING_4H"]);
    expect(s[0]).toMatchObject({ stop: 747.46, buffer: 0, risk: 7.54, shares: 2 });
    expect(s[1]).toMatchObject({ level: 751.77, buffer: 0.24, stop: 751.53, risk: 3.47, shares: 4 });
    expect(s[1].stopLimit).toBeLessThan(s[1].stop);
    expect(s[2]).toMatchObject({ level: 747.78, stop: 747.54 });
  });
  it("the stop never follows the entry: a higher entry only changes risk per share", () => {
    const a = suggestStops(ctx, lows1h, lows4h, 755, 16.25), b = suggestStops(ctx, lows1h, lows4h, 758, 16.25);
    expect(a[0].stop).toBe(b[0].stop); expect(a[1].stop).toBe(b[1].stop);
    expect(b[0].risk).toBeCloseTo(a[0].risk + 3, 2);
  });
  it("skips lows at or above the entry and drops duplicates", () => {
    const s = suggestStops(ctx, lows1h, lows4h, 750, 16.25);           // 751.77 is above → 1H falls to 747.78 = same as 4H
    expect(s.map((x) => x.id)).toEqual(["STRUCTURAL", "SWING_1H"]);
    expect(s[1].level).toBe(747.78);
  });
  it("flags a stop too wide for the risk budget and handles a missing entry", () => {
    expect(suggestStops(ctx, lows1h, lows4h, null, 16.25)).toEqual([]);
    const s = suggestStops(ctx, [], lows4h, 755, 5);
    expect(s.find((x) => x.id === "SWING_4H")!.shares).toBe(0);
  });
});
