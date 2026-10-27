// Funding / whole-share sizing / calculated R targets — the user's spec test case and edge cases.
import { describe, it, expect } from "vitest";
import { sizePosition, rTargets, parseNum, fundingStatus, r2, type SizingInput } from "@shared/positionSizing";

const base: SizingInput = { equity: 1800, riskPct: 1, riskPctLimit: 1, cash: 1800, allocation: 1000, entry: 66.93, stop: 65.82 };

describe("whole-share sizing — spec example", () => {
  const s = sizePosition(base);
  it("matches every expected value", () => {
    expect(s.ok).toBe(true);
    expect(s.riskPerShare).toBe(1.11);
    expect(s.riskBudget).toBe(18);
    expect(s.cashShares).toBe(14);
    expect(s.riskShares).toBe(16);
    expect(s.shares).toBe(14);
    expect(s.positionCost).toBe(937.02);
    expect(s.unusedAllocation).toBe(62.98);
    expect(s.cashRemaining).toBe(862.98);
    expect(s.plannedLoss).toBe(15.54);
    expect(s.riskPctOfEquity!.toFixed(2)).toBe("0.86");
    expect(s.riskPctOfEquity!).toBeCloseTo(0.8633, 4);
    expect(s.positionPctOfEquity!).toBeCloseTo(52.06, 2);
    expect(s.binding).toBe("REQUESTED_ALLOCATION");
  });
  it("2R…6R targets and full-position gross profit", () => {
    const t = rTargets(66.93, 65.82, s.shares, true);
    expect(t.map((x) => [x.r, x.price, x.grossProfit])).toEqual([[1.5, 68.6, 23.38], [2, 69.15, 31.08], [3, 70.26, 46.62], [4, 71.37, 62.16], [5, 72.48, 77.7], [6, 73.59, 93.24]]);
    expect(t[0].pctMove).toBeCloseTo(2.495, 3);
    expect(t[1].pctMove).toBeCloseTo(3.317, 3);
    expect(rTargets(66.93, 65.82, s.shares, false).map((x) => x.r)).toEqual([1.5, 2, 3]);
  });
  it("account-risk discrepancy: 14 × $1.11 = $15.54 is 0.86% of $1,800 but 0.96% of the saved $1,614.95", () => {
    expect(r2(14 * 1.11)).toBe(15.54);
    expect(((15.54 / 1800) * 100).toFixed(2)).toBe("0.86");
    expect(((15.54 / 1614.95) * 100).toFixed(2)).toBe("0.96");
    // At $1,614.95 the 1% budget is $16.15 → floor(16.15 / 1.11) = 14 risk-limited shares: the card's 14 came from risk, not cash.
    const at = sizePosition({ ...base, equity: 1614.95 });
    expect([at.riskBudget, at.riskShares, at.binding]).toEqual([16.15, 14, "CASH_AND_RISK"]);
  });
});

describe("other spec cases", () => {
  it("allocation $500 → 7 shares", () => { const s = sizePosition({ ...base, allocation: 500 }); expect([s.shares, s.binding]).toEqual([7, "REQUESTED_ALLOCATION"]); });
  it("available cash $400 (allocation $1,000) → 5 shares, cash binds", () => { const s = sizePosition({ ...base, cash: 400 }); expect([s.shares, s.binding, s.permitted]).toEqual([5, "AVAILABLE_CASH", 400]); });
  it("allocation below one share → 0 with explanation", () => {
    const s = sizePosition({ ...base, allocation: 50 }); expect(s.shares).toBe(0); expect(s.zeroReason).toMatch(/requested allocation \$50\.00 is below one share's cost \$66\.93/);
  });
  it("risk budget below one share's stop risk → 0 with explanation", () => {
    const s = sizePosition({ ...base, equity: 100 }); expect([s.riskBudget, s.riskShares, s.shares]).toEqual([1, 0, 0]); expect(s.zeroReason).toMatch(/risk budget \$1\.00 is below one share's stop risk \$1\.11/);
  });
  it("risk binds when the budget is smaller than cash", () => { const s = sizePosition({ ...base, riskPct: 0.5, riskPctLimit: 1 }); expect([s.riskShares, s.shares, s.binding]).toEqual([8, 8, "RISK"]); });
  it("invalid entry/stop blocks the calculation", () => {
    for (const bad of [{ stop: 66.93 }, { stop: 70 }, { entry: 0 }, { entry: -5 }, { stop: NaN }, { entry: null }]) {
      const s = sizePosition({ ...base, ...bad } as any); expect(s.ok).toBe(false); expect(s.shares).toBe(0); expect(s.issues.length).toBeGreaterThan(0);
    }
    expect(sizePosition({ ...base, stop: 67 }).issues[0].text).toMatch(/must be below entry/);
  });
  it("missing / zero / negative / nonnumeric funding inputs are explained", () => {
    expect(sizePosition({ ...base, equity: 0 }).issues[0].text).toMatch(/Account equity must be greater than zero/);
    expect(sizePosition({ ...base, cash: null }).issues[0].text).toMatch(/Available trading cash is missing/);
    expect(sizePosition({ ...base, allocation: parseNum("abc") }).issues[0].text).toMatch(/Requested allocation must be a number/);
    expect(sizePosition({ ...base, riskPct: -1 }).ok).toBe(false);
  });
  it("max risk % can't exceed the Risk Profile limit (capital protection)", () => {
    const s = sizePosition({ ...base, riskPct: 2, riskPctLimit: 1 }); expect(s.ok).toBe(false); expect(s.issues[0].text).toMatch(/above your Risk Profile limit of 1%/);
  });
  it("reservations reduce cash unless the cash figure already reflects them (no double count)", () => {
    const a = sizePosition({ ...base, cash: 1800, reservedOpen: 900, reservedPending: 500 }); expect([a.cashAfterReservations, a.shares, a.binding]).toEqual([400, 5, "AVAILABLE_CASH"]);
    const b = sizePosition({ ...base, cash: 1800, reservedOpen: 900, reservedPending: 500, cashIncludesReservations: true }); expect([b.cashAfterReservations, b.shares]).toEqual([1800, 14]);
  });
  it("estimated fees and execution buffer only tighten affordability, never round up", () => {
    const s = sizePosition({ ...base, allocation: 937.02, feePerTrade: 1 }); expect(s.shares).toBe(13);
    const t = sizePosition({ ...base, bufferPct: 7 }); expect(t.cashShares).toBe(Math.floor(1000 / (66.93 * 1.07))); expect(t.shares).toBe(13);
  });
  it("float dust never drops a share: $2.22 budget / $1.11 = exactly 2", () => {
    const s = sizePosition({ ...base, equity: 222, riskPct: 1, riskPctLimit: 1 }); expect(s.riskShares).toBe(2);
  });
  it("extended-target toggle never changes sizing", () => {
    const s = sizePosition(base); rTargets(66.93, 65.82, s.shares, true); expect(sizePosition(base)).toEqual(s);
  });
  it("parseNum and funding status", () => {
    expect([parseNum("$1,800.50"), parseNum(""), parseNum("12a")]).toEqual([1800.5, null, NaN]);
    expect(fundingStatus(null).state).toBe("UNAVAILABLE");
    expect(fundingStatus(new Date(Date.now() - 3600_000).toISOString()).state).toBe("MANUAL");
    expect(fundingStatus(new Date(Date.now() - 3 * 86400_000).toISOString()).state).toBe("STALE");
  });
});
