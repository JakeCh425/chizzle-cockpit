import { describe, it, expect } from "vitest";
import { buildPlan } from "../../server/swing/planMath";

const base = { trigger: 100, structureLow: 98.9, atr: 1, resistances: [] as number[], minRr: 2, maxDollarRisk: 100, entryBufferPct: 0.05, stopBufferAtr: 0.1 };

describe("planMath (§I)", () => {
  it("structural stop = structure low − ATR buffer; never a fixed %", () => {
    const p = buildPlan(base);
    expect(p.entry).toBeCloseTo(100.05, 2);
    expect(p.stop).toBeCloseTo(98.8, 2);
    expect(p.riskPerShare).toBeCloseTo(1.25, 2);
    expect(p.t1Source).not.toBe("resistance");
    expect(p.rrT1).toBeCloseTo(2, 1);
    expect(p.t2).toBeGreaterThan(p.t1!);
  });

  it("fixture 10: 1.5 / 2.0 / 2.5R minimum on a 2.2R setup → OK / OK / RR_TOO_LOW", () => {
    const p0 = buildPlan(base);
    const res = p0.entry! + 2.2 * p0.riskPerShare!;
    const at = (minRr: number) => buildPlan({ ...base, minRr, resistances: [res, res + 3] });
    expect(at(1.5).verdict).toBe("OK");
    expect(at(2.0).verdict).toBe("OK");
    const low = at(2.5);
    expect(low.verdict).toBe("RR_TOO_LOW");
    expect(low.rrT1).toBeCloseTo(2.2, 1);
    expect(low.nextResistance).toBeCloseTo(res, 2);
  });

  it("fixture 11: $50 max risk vs $60/share → STOP_TOO_WIDE, 0 shares", () => {
    const p = buildPlan({ ...base, trigger: 1000, structureLow: 941.5, atr: 10, entryBufferPct: 0.05, maxDollarRisk: 50 });
    expect(p.riskPerShare).toBeCloseTo(60, 0);
    expect(p.verdict).toBe("STOP_TOO_WIDE");
    expect(p.shares).toBe(0);
    const ok = buildPlan({ ...base, trigger: 1000, structureLow: 941.5, atr: 10, maxDollarRisk: 600 });
    expect(ok.shares).toBe(10); // floor(600 / 60) — a suggestion, never an order
  });
});
