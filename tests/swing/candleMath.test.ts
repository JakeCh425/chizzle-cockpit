import { describe, it, expect } from "vitest";
import { stats, shortTermDecline, clusterOfLows, elevatedVolume, extension, isExtended, nearSupport, bullishReversal, sma, atr } from "../../server/swing/candleMath";

const b = (o: number, h: number, l: number, c: number, v?: number) => ({ t: 0, o, h, l, c, v });

describe("candle stats (spec §F)", () => {
  it("computes body, range, wicks, ratios", () => {
    const s = stats(b(100, 104, 98, 103));
    expect(s).toMatchObject({ body: 3, range: 6, bodyRatio: 0.5, lowerWick: 2, upperWick: 1, isGreen: true, isRed: false });
    expect(s.closePosition).toBeCloseTo(5 / 6);
  });
  it("zero range → ratios 0", () => {
    expect(stats(b(100, 100, 100, 100))).toMatchObject({ bodyRatio: 0, closePosition: 0, isGreen: false, isRed: false });
  });
});

describe("context", () => {
  it("shortTermDecline: 3 reds in prior 7", () => {
    expect(shortTermDecline([b(10, 11, 9, 9.5), b(9.5, 10, 9, 9.2), b(9.2, 9.5, 8.8, 9)]).ok).toBe(true);
    expect(shortTermDecline([b(9, 11, 9, 10.5), b(10, 11, 9.5, 10.8), b(10.8, 11, 10.5, 10.9)]).ok).toBe(false);
  });
  it("clusterOfLows: 3 lows within 0.5%", () => {
    const r = clusterOfLows([b(101, 102, 100, 101), b(101, 102, 100.3, 101), b(101, 102, 100.4, 101), b(102, 103, 101.5, 102)]);
    expect(r).toMatchObject({ ok: true, swingLow: 100, hits: 3 });
  });
  it("elevatedVolume: ≥1.2× 10-bar avg; unknown volume → null", () => {
    const prior = Array.from({ length: 10 }, () => b(1, 2, 0, 1, 1000));
    expect(elevatedVolume(b(1, 2, 0, 1, 1300), prior)).toMatchObject({ ok: true });
    expect(elevatedVolume(b(1, 2, 0, 1, 1100), prior).ok).toBe(false);
    expect(elevatedVolume(b(1, 2, 0, 1), prior).ok).toBeNull();
  });
  it("nearSupport within max(0.5%, 0.5 ATR)", () => {
    expect(nearSupport(b(100, 101, 99.6, 100.5), [], [{ name: "S", price: 99.2 }], null).ok).toBe(true);
    expect(nearSupport(b(100, 101, 99.6, 100.5), [], [{ name: "S", price: 98.5 }], null).ok).toBe(false);
    expect(nearSupport(b(100, 101, 99.6, 100.5), [], [{ name: "S", price: 98.5 }], 3).ok).toBe(true);
  });
  it("bullishReversal classifies hammer / engulfing / strong bull", () => {
    expect(bullishReversal(b(99.2, 99.45, 98.8, 99.35), undefined).kind).toBe("hammer");
    expect(bullishReversal(b(99.1, 99.8, 99.0, 99.7), b(99.6, 99.7, 99.1, 99.2)).kind).toBe("bullish engulfing");
    expect(bullishReversal(b(100, 101.1, 99.95, 101), undefined).kind).toBe("strong bull bar");
    expect(bullishReversal(b(101, 101.1, 99.95, 100), undefined).ok).toBe(false);
  });
});

describe("indicators + extension", () => {
  it("sma / atr", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(atr([b(10, 11, 9, 10), b(10, 12, 10, 11), b(11, 11.5, 10.5, 11)])).toBeCloseTo(1.5);
  });
  it("extension % and ATR; extended if either limit exceeded", () => {
    expect(extension(101, 100, 2)).toEqual({ pct: 1, atr: 0.5 });
    expect(isExtended(100.9, 100, 2, 1.0, 1.25)).toBe(false);
    expect(isExtended(101.2, 100, 2, 1.0, 1.25)).toBe(true);   // % limit
    expect(isExtended(100.8, 100, 0.5, 1.0, 1.25)).toBe(true); // ATR limit (1.6 ATR)
  });
});
