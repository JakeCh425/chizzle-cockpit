import { describe, it, expect } from "vitest";
import {
  detectAll, detectHammer, detectEngulfing, detectStrongBullAfterCluster, detectAggressiveBounce,
  detectBreakoutRetest, detectReclaimMomentum, detectFirstPullback, detectHigherLowConsolidation,
} from "../../server/swing/detectors";
import * as F from "../fixtures/setups";
import { mk4H, flat } from "../fixtures/builders";
import { SETUP_TYPES } from "@shared/swingDecision";

const show = (d: { passed: string[]; failed: string[]; missing: string[] }) => JSON.stringify({ p: d.passed, f: d.failed, m: d.missing });

describe("setup library (spec §G) — each fixture confirms its setup", () => {
  it("1 Hammer", () => {
    const d = detectHammer(F.hammer());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.trigger).toBe(99.45);
    expect(d.structureLow).toBe(98.8);
  });
  it("1 Hammer — developing bar is FORMING, never CONFIRMED", () => {
    const d = detectHammer(F.hammerForming());
    expect(d.stage, show(d)).toBe("FORMING");
    expect(d.passed.join(" ")).toMatch(/NOT confirmed until close/);
  });
  it("2 Bullish Engulfing", () => {
    const d = detectEngulfing(F.engulfing());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.structureLow).toBe(99.05);
  });
  it("3 Strong Bull Bar after cluster of lows", () => {
    const d = detectStrongBullAfterCluster(F.strongBullCluster());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.levels.clusterLow).toBe(98);
  });
  it("4 Aggressive Bounce (volume preferred in Standard)", () => {
    const d = detectAggressiveBounce(F.aggressiveBounce(2000));
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.volume).toBe("PASS");
    const lowVol = detectAggressiveBounce(F.aggressiveBounce(900, "STANDARD"));
    expect(lowVol.stage, show(lowVol)).toBe("CONFIRMED");
    expect(lowVol.volume).toBe("FAIL");
  });
  it("4 Aggressive Bounce — volume REQUIRED in Strict", () => {
    const d = detectAggressiveBounce(F.aggressiveBounce(900, "STRICT"));
    expect(d.stage).not.toBe("CONFIRMED");
    expect(d.failed.join(" ")).toMatch(/required in Strict/);
  });
  it("5 Breakout-Retest", () => {
    const d = detectBreakoutRetest(F.breakoutRetest());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.levels.breakout).toBe(100.6);
    expect(d.trigger).toBe(101.6);       // reversal high
    expect(d.structureLow).toBe(100.65); // retest low
  });
  it("6 Reclaim + Momentum Continuation reaches MOMENTUM phase", () => {
    const d = detectReclaimMomentum(F.reclaimMomentum());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.phase).toBe("MOMENTUM");
    expect(d.trigger).toBe(100.95);
    expect(d.structureLow).toBe(100.3);
  });
  it("6 Reclaim only (no 1H bars yet) stays at RECLAIM phase with missing conditions", () => {
    const ctx = F.reclaimMomentum(); ctx.bars1h = [];
    const d = detectReclaimMomentum(ctx);
    expect(d.stage).toBe("CONFIRMED");
    expect(d.phase).toBe("RECLAIM");
    expect(d.missing.length).toBeGreaterThan(0);
  });
  it("7 First Pullback After Breakout", () => {
    const d = detectFirstPullback(F.firstPullback());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.trigger).toBe(101.7);
    expect(d.structureLow).toBe(100.7);
  });
  it("7 disabled by setting", () => {
    expect(detectFirstPullback({ ...F.firstPullback(), allowFirstPullback: false }).failed).toContain("disabled in settings");
  });
  it("8 Higher-Low Consolidation", () => {
    const d = detectHigherLowConsolidation(F.higherLowConsolidation());
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.levels).toMatchObject({ higherLow: 100.1, priorLow: 99, consHigh: 100.8 });
  });
});

describe("detectAll — never silent (spec: 'Never silently return no card')", () => {
  it("returns all 8 setups, each with a stage and at least one reason", () => {
    for (const ctx of [F.noSetup(), F.hammer(), F.reclaimMomentum()]) {
      const all = detectAll(ctx);
      expect(all.map((d) => d.type)).toEqual([...SETUP_TYPES]);
      for (const d of all) expect(d.passed.length + d.failed.length + d.missing.length, d.type).toBeGreaterThan(0);
    }
  });
  it("no-setup fixture confirms nothing and explains why", () => {
    const all = detectAll(F.noSetup());
    expect(all.filter((d) => d.stage === "CONFIRMED").map((d) => d.type)).toEqual([]);
  });
  it("a quiet range confirms nothing (no false positives from chop)", () => {
    const all = detectAll({ bars4h: mk4H(flat(40)), bars1h: [], signalMode: "FLEXIBLE" });
    expect(all.filter((d) => d.stage === "CONFIRMED").map((d) => d.type)).toEqual([]);
  });
  it("specific shapes stay specific", () => {
    const confirmed = (ctx: any) => detectAll(ctx).filter((d) => d.stage === "CONFIRMED").map((d) => d.type);
    expect(confirmed(F.hammer())).toEqual(["HAMMER"]);
    expect(confirmed(F.higherLowConsolidation())).toEqual(["HIGHER_LOW_CONSOLIDATION"]);
    expect(confirmed(F.engulfing())).toContain("BULLISH_ENGULFING");
    expect(confirmed(F.engulfing())).not.toContain("HAMMER");
  });
  it("setup history survives later bars (confirmed 2 bars ago still reported)", () => {
    const ctx = F.hammer();
    const last = ctx.bars4h[ctx.bars4h.length - 1];
    const step = last.end - last.t;
    ctx.bars4h.push({ ...last, t: last.end, end: last.end + step, o: 99.4, h: 99.9, l: 99.3, c: 99.8 });
    ctx.bars4h.push({ ...last, t: last.end + step, end: last.end + 2 * step, o: 99.8, h: 100.4, l: 99.7, c: 100.3 });
    const d = detectHammer(ctx);
    expect(d.stage, show(d)).toBe("CONFIRMED");
    expect(d.passed.join(" ")).toMatch(/2 closed 4H bar\(s\) ago/);
  });
});
