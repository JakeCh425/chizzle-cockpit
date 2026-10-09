import { describe, it, expect } from "vitest";
import { engineNowSays, lockedPriceWarning } from "../../shared/swingTrades";

const t = { entry: 100, stop: 95, t1: 110, t2: 115 };
describe("Part 5 — engine never overwrites locked levels; it only reports", () => {
  it("is silent when the engine agrees or has no plan", () => {
    expect(engineNowSays(t, { entry: 100, stop: 95, t1: 110, t2: 115 }).text).toBeNull();
    expect(engineNowSays(t, null).text).toBeNull();
    expect(engineNowSays(t, { entry: null, stop: null, t1: null, t2: null }).changed).toEqual([]);
  });
  it("names only the levels that differ (and ignores sub-cent noise)", () => {
    const s = engineNowSays(t, { entry: 100.004, stop: 94.5, t1: 112, t2: 115 });
    expect(s.changed).toEqual(["stop", "t1"]);
    expect(s.text).toBe("Engine now says stop $94.50 · T1 $112.00 — your locked levels are unchanged.");
  });
  it("collapsed-row warning fires at/below stop and at/above T1, never in between", () => {
    const tr = { status: "ACTIVE" as const, entry: 100, stop: 95, t1: 110, fillPrice: 100.2 };
    expect(lockedPriceWarning(tr, 94.99)).toMatch(/below your stop/);
    expect(lockedPriceWarning(tr, 95)).toMatch(/below your stop/);
    expect(lockedPriceWarning(tr, 110)).toMatch(/above your T1/);
    expect(lockedPriceWarning(tr, 102)).toBeNull();
    expect(lockedPriceWarning(tr, null)).toBeNull();
  });
});
