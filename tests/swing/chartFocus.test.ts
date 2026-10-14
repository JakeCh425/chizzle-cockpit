// Chart Focus mode + clean-up rules — visual only. PRACTICE ONLY — ANALYSIS, NOT FINANCIAL ADVICE.
import { describe, it, expect } from "vitest";
import { dayLevelsApply, dimColor, FOCUS_FADE_MS, focusView, mergeNearbyLevels, mergeTolerance, srLabel } from "@shared/chartFocus";

const L = (price: number, strength = 50, touches = 2) => ({ price, strength, touches, source: "PIVOT" });

describe("chart focus mode", () => {
  it("merges same-side levels within ½ ATR (chain linkage, strongest represents the zone)", () => {
    const tol = mergeTolerance(568, 13.45); // SMH Daily ATR 13.45 → 6.725
    expect(tol).toBeCloseTo(6.725, 3);
    const m = mergeNearbyLevels([L(566.8, 55, 2), L(568, 60, 2), L(574.75, 70, 3), L(588.63, 40, 1)], tol);
    expect(m.length).toBe(3);
    expect(m[0]).toMatchObject({ low: 566.8, high: 568, price: 568, members: 2, touches: 4 });
    expect(m[1]).toMatchObject({ low: 574.75, high: 574.75, members: 1 });
    // chain: 1.0 apart each step, all within tolerance of the neighbour → one zone
    expect(mergeNearbyLevels([L(100), L(101), L(102, 80)], 1.2)).toHaveLength(1);
    expect(mergeNearbyLevels([L(100), L(101), L(102, 80)], 1.2)[0]).toMatchObject({ price: 102, low: 100, high: 102 });
    // never invents or moves prices: every output price is an input price
    const inp = [L(10), L(10.02), L(11), L(13)];
    for (const x of mergeNearbyLevels(inp, 0.05)) expect(inp.map((i) => i.price)).toContain(x.price);
    expect(mergeTolerance(500, null)).toBeCloseTo(2, 6); // fallback 0.4 %
  });

  it("day levels only on intraday charts", () => {
    for (const tf of ["15m", "30m", "1H", "4H"]) expect(dayLevelsApply(tf)).toBe(true);
    for (const tf of ["D", "W"]) expect(dayLevelsApply(tf)).toBe(false);
  });

  it("focus view: clean until hovered; ARMED/ACTIVE plan stays; Full keeps everything", () => {
    const base = { focus: true, revealed: false, pinLevels: false, highlight: false, lockedPlan: false, planOn: true };
    expect(focusView(base)).toEqual({ full: false, plan: false, nearestOnly: true, dimIndicators: true });
    expect(focusView({ ...base, revealed: true })).toMatchObject({ full: true, plan: true, nearestOnly: false });
    expect(focusView({ ...base, lockedPlan: true })).toMatchObject({ full: false, plan: true });
    expect(focusView({ ...base, pinLevels: true }).plan).toBe(true);
    expect(focusView({ ...base, focus: false })).toMatchObject({ full: true, dimIndicators: false });
    expect(focusView({ ...base, planOn: false, lockedPlan: true }).plan).toBe(false);
    expect(FOCUS_FADE_MS).toBe(1500);
  });

  it("labels + colours", () => {
    expect(srLabel("R", { price: 568, low: 566.8, high: 568, members: 2 }, "●●○", true)).toBe("Near res 566.80–568.00 ●●○");
    expect(srLabel("S", { price: 559.56, low: 559.56, high: 559.56, members: 1 }, "●●●", false)).toBe("Sup $559.56 ●●●");
    expect(dimColor("#38bdf8")).toBe("rgba(56,189,248,0.32)");
    expect(dimColor("rgb(1,2,3)")).toBe("rgb(1,2,3)");
    for (const t of [srLabel("R", { price: 1, low: 1, high: 1, members: 1 }, "", true)]) expect(t).not.toMatch(/buy|sell/i);
  });
});
